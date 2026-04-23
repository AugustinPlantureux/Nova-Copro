import Head from 'next/head';
import Link from 'next/link';

export default function Custom404() {
  return (
    <>
      <Head><title>Page introuvable — Nova Copro</title></Head>
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6 text-center">
        <div className="text-6xl mb-4">🏢</div>
        <h1 className="text-4xl font-bold text-gray-900 mb-2">404</h1>
        <p className="text-gray-500 mb-8">Cette page n'existe pas ou vous n'y avez pas accès.</p>
        <Link href="/" className="btn-primary inline-flex">Retour à l'accueil</Link>
      </div>
    </>
  );
}
