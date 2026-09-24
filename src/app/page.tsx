import Link from 'next/link';
export default function Home() {
  return (
    <section className="card narrow">
      <p className="eyebrow">PASSWORD SELF-SERVICE</p>
      <h1>
        A fresh password.
        <br />
        The same secure access.
      </h1>
      <p>
        Open the temporary link sent by your administrator to change your SMB
        password. You will need your current password.
      </p>
      <Link className="button" href="/admin">
        Administrator sign in
      </Link>
    </section>
  );
}
