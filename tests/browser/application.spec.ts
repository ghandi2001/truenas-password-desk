import { test, expect } from '@playwright/test';
test('persian RTL default, admin flow, switching preserves generated link', async ({
  page,
}) => {
  await page.route('**/api/admin/smb-users', (route) =>
    route.fulfill({ json: { users: ['smbuser'] } }),
  );
  await page.goto('/admin');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fa');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page).toHaveTitle('میز رمز عبور');
  await page.getByLabel('نام کاربری مدیر').fill('operator');
  await page
    .getByLabel('رمز عبور مدیر', { exact: true })
    .fill('Browser fixture passphrase!');
  await page.getByRole('button', { name: 'ورود امن' }).click();
  await expect(
    page.getByRole('heading', { name: 'پیوندهای رمز عبور', exact: true }),
  ).toBeVisible();
  // SMB picker lists NAS users as searchable options.
  await expect(
    page.getByText('جست‌وجو در میان ۱ کاربر SMB سرور'),
  ).toBeVisible();
  const picker = page.locator('.user-select input[name=username]');
  await picker.click();
  await expect(page.getByRole('option', { name: 'smbuser' })).toBeVisible();
  // Filtering narrows; no-match state shows the localized empty message.
  await picker.fill('zzz');
  await expect(page.getByText('کاربری مطابق نیست')).toBeVisible();
  await picker.fill('smb');
  await page.getByRole('option', { name: 'smbuser' }).click();
  await expect(picker).toHaveValue('smbuser');
  await picker.fill('alice');
  await page.getByRole('button', { name: 'ایجاد پیوند یک‌بارمصرف' }).click();
  const link = page.locator('.issued input[readonly]');
  await expect(link).toBeVisible();
  const url = await link.inputValue();
  expect(url).toMatch(/\/password-change\/[A-Za-z0-9_-]{43}$/);
  // Switch language in place: the one-time URL must survive.
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(link).toHaveValue(url);
  await expect(
    page.getByRole('heading', { name: 'Password links', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await expect(link).toHaveCount(0);
  await page.getByRole('button', { name: 'Revoke link for alice' }).click();
  await expect(page.getByText('Revoked', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Welcome back.' }),
  ).toBeVisible();
  // Preference persists across a fresh navigation (server reads cookie).
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await page.goto(url);
  await expect(
    page.getByText(
      'This link is unavailable. Ask your administrator for a new link.',
    ),
  ).toBeVisible();
  await expect(page.locator('input[type=password]')).toHaveCount(0);
});
test('public form clears values on failed request and succeeds with mocked API', async ({
  page,
}) => {
  const token = 'b'.repeat(43);
  let used = false;
  let fail = true;
  await page.route('**/api/password-change/' + token, async (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({
        status: used ? 404 : 200,
        json: used
          ? {
              error:
                'This link is unavailable. Ask your administrator for a new link.',
            }
          : { valid: true, minLength: 8 },
      });
    const data = route.request().postDataJSON();
    expect(Object.keys(data).sort()).toEqual([
      'confirmPassword',
      'newPassword',
    ]);
    if (fail)
      return route.fulfill({
        status: 400,
        json: { error: 'The password could not be changed. Try again.' },
      });
    used = true;
    return route.fulfill({ json: { ok: true } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/password-change/' + token);
  // Persian default with RTL layout on the public page; no current-password field.
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByLabel('رمز عبور جدید', { exact: true })).toBeVisible();
  await expect(page.locator('input[type=password]')).toHaveCount(2);
  const fill = async () => {
    await page
      .getByLabel('رمز عبور جدید', { exact: true })
      .fill('New fixture passphrase!');
    await page
      .getByLabel('تأیید رمز عبور جدید', { exact: true })
      .fill('New fixture passphrase!');
  };
  await fill();
  await page.getByRole('button', { name: 'نمایش رمز عبور جدید' }).click();
  await expect(page.locator('input[name=newPassword]')).toHaveAttribute(
    'type',
    'text',
  );
  await page.getByRole('button', { name: 'تغییر رمز عبورم' }).click();
  await expect(page.getByRole('status')).toContainText(
    'تغییر رمز عبور ممکن نشد',
  );
  for (const input of await page.locator('input').all())
    await expect(input).toHaveValue('');
  // Language switch mid-flow keeps entered values.
  await fill();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.locator('input[name=newPassword]')).toHaveValue(
    'New fixture passphrase!',
  );
  fail = false;
  await page.getByRole('button', { name: 'Change my password' }).click();
  await expect(
    page.getByRole('heading', { name: 'You’re all set.' }),
  ).toBeVisible();
  await expect(page.locator('input')).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.reload();
  await expect(
    page.getByText(
      'This link is unavailable. Ask your administrator for a new link.',
    ),
  ).toBeVisible();
});
test('invalid locale cookie falls back to persian; unknown API error uses generic fallback', async ({
  page,
  context,
}) => {
  await context.addCookies([
    { name: 'locale', value: 'fr', url: 'http://127.0.0.1:3100' },
  ]);
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fa');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  const token = 'c'.repeat(43);
  await page.route('**/api/password-change/' + token, async (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({
        status: 500,
        json: { error: 'Unexpected upstream text' },
      });
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/password-change/' + token);
  await expect(page.getByRole('status')).toContainText(
    'تکمیل درخواست ممکن نشد',
  );
});
