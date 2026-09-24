import { test, expect } from '@playwright/test';
test('admin login, issuance, one-time copy, revocation, logout and session protection', async ({
  page,
}) => {
  await page.goto('/admin');
  await page.getByLabel('Admin username').fill('operator');
  await page
    .getByLabel('Admin password', { exact: true })
    .fill('Browser fixture passphrase!');
  await page.getByRole('button', { name: 'Sign in securely' }).click();
  await expect(
    page.getByRole('heading', { name: 'Password links', exact: true }),
  ).toBeVisible();
  await page.getByLabel('TrueNAS username').fill('alice');
  await page.getByRole('button', { name: 'Generate one-time link' }).click();
  const link = page.getByLabel('Generated password-change link');
  await expect(link).toBeVisible();
  const url = await link.inputValue();
  expect(url).toMatch(/\/password-change\/[A-Za-z0-9_-]{43}$/);
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await expect(link).toHaveCount(0);
  await page.getByRole('button', { name: 'Revoke link for alice' }).click();
  await expect(page.getByText('Revoked', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Welcome back.' }),
  ).toBeVisible();
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
          : { valid: true, minLength: 12 },
      });
    const data = route.request().postDataJSON();
    expect(Object.keys(data).sort()).toEqual([
      'confirmPassword',
      'currentPassword',
      'newPassword',
    ]);
    if (fail)
      return route.fulfill({
        status: 400,
        json: {
          error:
            'The password could not be changed. Verify your current password and try again.',
        },
      });
    used = true;
    return route.fulfill({ json: { ok: true } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/password-change/' + token);
  const fill = async () => {
    await page
      .getByLabel('Current password', { exact: true })
      .fill('Current fixture!');
    await page
      .getByLabel('New password', { exact: true })
      .fill('New fixture passphrase!');
    await page
      .getByLabel('Confirm new password', { exact: true })
      .fill('New fixture passphrase!');
  };
  await fill();
  await page.getByRole('button', { name: 'Show current password' }).click();
  await expect(page.locator('input[name=currentPassword]')).toHaveAttribute(
    'type',
    'text',
  );
  await page.getByRole('button', { name: 'Change my password' }).click();
  await expect(page.getByRole('status')).toContainText('could not be changed');
  for (const input of await page.locator('input').all())
    await expect(input).toHaveValue('');
  fail = false;
  await fill();
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
