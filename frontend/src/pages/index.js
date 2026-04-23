import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import toast from 'react-hot-toast';
import { Mail, ArrowRight, RefreshCw, CheckCircle } from 'lucide-react';
import { authAPI, saveSession } from '../lib/api';
import { useAuth } from '../lib/auth';
import OTPInput from '../components/OTPInput';
import Logo from '../components/Logo';

const RESEND_DELAY = 60; // secondes

export default function LoginPage() {
  const { user, login } = useAuth();
  const router = useRouter();

  const [step, setStep] = useState('email'); // 'email' | 'otp'
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);

  // Redirect si déjà connecté
  useEffect(() => {
    if (user) router.replace('/dashboard');
  }, [user, router]);

  // Message session expirée
  useEffect(() => {
    if (router.query.session === 'expired') {
      toast.error('Votre session a expiré. Veuillez vous reconnecter.');
    }
  }, [router.query]);

  // Countdown pour renvoyer le code
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const handleSendCode = async (e) => {
    e?.preventDefault();
    if (!email || !email.includes('@')) {
      toast.error('Veuillez saisir un email valide');
      return;
    }
    setLoading(true);
    try {
      await authAPI.sendCode(email.trim().toLowerCase());
      setStep('otp');
      setCountdown(RESEND_DELAY);
      toast.success('Code envoyé ! Vérifiez votre boîte email.');
    } catch (err) {
      const msg = err.response?.data?.error || 'Erreur lors de l\'envoi';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  // handleVerify déclaré AVANT le useEffect qui l'appelle
  const handleVerify = useCallback(async () => {
    if (otp.length < 6) {
      toast.error('Veuillez saisir le code complet');
      return;
    }
    setLoading(true);
    try {
      const { data } = await authAPI.verifyCode(email, otp, rememberMe);
      saveSession(data.token, data.user, rememberMe);
      login(data.user);
      toast.success(`Bienvenue${data.user.prenom ? ` ${data.user.prenom}` : ''} !`);
      router.push('/dashboard');
    } catch (err) {
      const msg = err.response?.data?.error || 'Code invalide ou expiré';
      toast.error(msg);
      setOtp('');
    } finally {
      setLoading(false);
    }
  }, [otp, email, rememberMe, login, router]);

  // Auto-submit quand les 6 chiffres sont saisis
  useEffect(() => {
    if (otp.replace(/\s/g, '').length === 6 && step === 'otp') {
      handleVerify();
    }
  }, [otp, step, handleVerify]);

  return (
    <>
      <Head>
        <title>Connexion — Nova Copro</title>
        <meta name="description" content="Accédez à votre espace documentaire copropriété" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className="min-h-screen flex">
        {/* Panneau gauche - Branding */}
        <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-brand-900 via-brand-800 to-brand-600 flex-col justify-between p-12 relative overflow-hidden">
          {/* Cercles décoratifs */}
          <div className="absolute top-0 right-0 w-96 h-96 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/4" />
          <div className="absolute bottom-0 left-0 w-64 h-64 bg-white/5 rounded-full translate-y-1/3 -translate-x-1/4" />

          <Logo size="md" />

          <div className="relative z-10">
            <h2 className="text-4xl font-bold text-white mb-6 leading-tight">
              Vos documents de<br />copropriété, centralisés<br />et accessibles.
            </h2>
            <p className="text-blue-200 text-lg leading-relaxed max-w-sm">
              PV d'assemblées générales, appels de fonds, règlement de copropriété — 
              tout est là, sécurisé et organisé.
            </p>
          </div>

          <div className="relative z-10 flex items-center gap-2 text-blue-300 text-sm">
            <CheckCircle size={16} />
            <span>Connexion sécurisée sans mot de passe</span>
          </div>
        </div>

        {/* Panneau droit - Formulaire */}
        <div className="w-full lg:w-1/2 flex flex-col items-center justify-center p-6 lg:p-12 bg-gray-50">
          
          {/* Logo mobile */}
          <div className="lg:hidden mb-10 bg-gradient-to-br from-brand-900 to-brand-600 rounded-2xl px-6 py-4">
            <Logo size="sm" />
          </div>

          <div className="w-full max-w-sm">

            {/* ── ÉTAPE 1 : EMAIL ── */}
            {step === 'email' && (
              <div>
                <h1 className="text-2xl font-bold text-gray-900 mb-2">Connexion</h1>
                <p className="text-gray-500 mb-8">
                  Saisissez votre email pour recevoir un code de connexion.
                </p>

                <form onSubmit={handleSendCode} className="space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      Adresse email
                    </label>
                    <div className="relative">
                      <Mail size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="votre@email.com"
                        className="input-field pl-10"
                        required
                        autoFocus
                        autoComplete="email"
                        disabled={loading}
                      />
                    </div>
                  </div>

                  <label className="flex items-center gap-3 cursor-pointer group">
                    <div
                      onClick={() => setRememberMe(!rememberMe)}
                      className={`w-5 h-5 rounded flex items-center justify-center border-2 transition-all flex-shrink-0
                        ${rememberMe ? 'bg-brand-600 border-brand-600' : 'border-gray-300 group-hover:border-brand-400'}`}
                    >
                      {rememberMe && (
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                    <span className="text-sm text-gray-600 select-none">Rester connecté (30 jours)</span>
                  </label>

                  <button
                    type="submit"
                    disabled={loading || !email}
                    className="btn-primary w-full flex items-center justify-center gap-2"
                  >
                    {loading ? (
                      <RefreshCw size={18} className="animate-spin" />
                    ) : (
                      <>
                        <span>Recevoir mon code</span>
                        <ArrowRight size={18} />
                      </>
                    )}
                  </button>
                </form>
              </div>
            )}

            {/* ── ÉTAPE 2 : OTP ── */}
            {step === 'otp' && (
              <div>
                <button
                  onClick={() => { setStep('email'); setOtp(''); }}
                  className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6 -ml-1 transition-colors"
                >
                  ← Changer d'email
                </button>

                <h1 className="text-2xl font-bold text-gray-900 mb-2">Code de vérification</h1>
                <p className="text-gray-500 mb-1">
                  Nous avons envoyé un code à 6 chiffres à
                </p>
                <p className="text-brand-600 font-semibold mb-8 truncate">{email}</p>

                <div className="mb-6">
                  <OTPInput value={otp} onChange={setOtp} disabled={loading} />
                </div>

                <button
                  onClick={handleVerify}
                  disabled={loading || otp.length < 6}
                  className="btn-primary w-full flex items-center justify-center gap-2 mb-4"
                >
                  {loading ? (
                    <RefreshCw size={18} className="animate-spin" />
                  ) : (
                    <>
                      <CheckCircle size={18} />
                      <span>Confirmer la connexion</span>
                    </>
                  )}
                </button>

                {/* Renvoyer le code */}
                <div className="text-center">
                  {countdown > 0 ? (
                    <p className="text-sm text-gray-400">
                      Renvoyer le code dans{' '}
                      <span className="font-semibold text-gray-600">{countdown}s</span>
                    </p>
                  ) : (
                    <button
                      onClick={handleSendCode}
                      disabled={loading}
                      className="text-sm text-brand-600 hover:text-brand-700 font-medium transition-colors"
                    >
                      Renvoyer le code
                    </button>
                  )}
                </div>

                <p className="text-xs text-gray-400 text-center mt-4">
                  Vérifiez aussi vos spams et courriers indésirables.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}