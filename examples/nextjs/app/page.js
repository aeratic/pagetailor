import PageClient from "./PageClient.jsx";

export default async function Home({ searchParams }) {
  const { user = "giulia", role = "marketing" } = await searchParams;
  return <PageClient page="home" user={user} role={role} />;
}
