import ChangeForm from '@/components/change-form';
export default async function PasswordChange({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  return <ChangeForm token={(await params).token} />;
}
