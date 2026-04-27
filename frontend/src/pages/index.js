import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import toast from 'react-hot-toast';
import { Mail, ArrowRight, RefreshCw, CheckCircle, Send, AlertCircle } from 'lucide-react';
import { authAPI, saveSession } from '../lib/api';
import { useAuth } from '../lib/auth';
import OTPInput from '../components/OTPInput';
import Logo from '../components/Logo';

const RESEND_DELAY = 60;

// ── Étape 3 : demande d'accès ─────────────────────────────────
function AccessRequestStep({ email, onBack }) {
  const [message, setMessage]   = useState('');
  const [loading, setLoading]   = useState(false);
  const [sent,    setSent]      = useState(false);

  const handleSubmit = async () => {
    setLoading(true);
    try {
      await authAPI.requestAccess(email, message);
      setSent(true);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de l\'envoi. Veuillez réessayer.');
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="text-center">
        <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-5">
          <CheckCircle size={32} className="text-emerald-500" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-3">Demande envoyée</h1>
        <p className="text-gray-500 mb-2">
          Votre demande a bien été transmise au gestionnaire de votre copropriété.
        </p>
        <p className="text-gray-400 text-sm mb-8">
          Vous recevrez un email dès que votre accès sera configuré.
        </p>
        <button onClick={onBack}
          className="text-sm text-brand-600 hover:text-brand-700 font-medium transition-colors">
          ← Retour
        </button>
      </div>
    );
  }

  return (
    <div>
      <button onClick={onBack}
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6 -ml-1 transition-colors">
        ← Retour
      </button>

      <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
        <AlertCircle size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-amber-800">Accès non configuré</p>
          <p className="text-sm text-amber-700 mt-0.5">
            L'adresse <strong>{email}</strong> n'est pas encore enregistrée dans Nova Copro.
          </p>
        </div>
      </div>

      <h1 className="text-2xl font-bold text-gray-900 mb-2">Demander un accès</h1>
      <p className="text-gray-500 mb-6">
        Envoyez une demande au gestionnaire de votre copropriété. Il vous répondra par email.
      </p>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Votre email</label>
          <input type="email" value={email} disabled
            className="input-field bg-gray-50 text-gray-500 cursor-not-allowed" />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Message <span className="text-gray-400 font-normal">(optionnel)</span>
          </label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Précisez votre copropriété, votre nom, ou toute information utile…"
            rows={3}
            className="input-field resize-none"
            maxLength={500}
          />
          <p className="text-xs text-gray-400 mt-1">{message.length}/500</p>
        </div>

        <button onClick={handleSubmit} disabled={loading}
          className="btn-primary w-full flex items-center justify-center gap-2">
          {loading
            ? <RefreshCw size={18} className="animate-spin" />
            : <><Send size={16} /><span>Envoyer la demande</span></>
          }
        </button>
      </div>
    </div>
  );
}

// ── Page principale ───────────────────────────────────────────
export default function LoginPage() {
  const { user, login } = useAuth();
  const router = useRouter();

  // step : 'email' | 'otp' | 'access_request'
  const [step,       setStep]       = useState('email');
  const [email,      setEmail]      = useState('');
  const [otp,        setOtp]        = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [loading,    setLoading]    = useState(false);
  const [countdown,  setCountdown]  = useState(0);

  useEffect(() => { if (user) router.replace('/dashboard'); }, [user, router]);

  useEffect(() => {
    if (router.query.session === 'expired') toast.error('Votre session a expiré. Veuillez vous reconnecter.');
    else if (router.query.session === 'invalid') toast.error('Session invalide. Veuillez vous reconnecter.');
  }, [router.query]);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  const handleVerify = useCallback(async () => {
    if (otp.length < 6) { toast.error('Veuillez saisir le code complet'); return; }
    setLoading(true);
    try {
      const { data } = await authAPI.verifyCode(email, otp, rememberMe);
      saveSession(data.user, rememberMe);
      login(data.user);
      toast.success(`Bienvenue${data.user.prenom ? ` ${data.user.prenom}` : ''} !`);
      router.push('/dashboard');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Code invalide ou expiré');
      setOtp('');
    } finally {
      setLoading(false);
    }
  }, [otp, email, rememberMe, login, router]);

  useEffect(() => {
    if (otp.replace(/\s/g, '').length === 6 && step === 'otp') handleVerify();
  }, [otp, step, handleVerify]);

  const handleSendCode = async (e) => {
    e?.preventDefault();
    if (!email || !email.includes('@')) { toast.error('Veuillez saisir un email valide'); return; }
    setLoading(true);
    try {
      await authAPI.sendCode(email.trim().toLowerCase());
      setStep('otp');
      setCountdown(RESEND_DELAY);
      toast.success('Code envoyé ! Vérifiez votre boîte email.');
    } catch (err) {
      // 404 = email inconnu → page de demande d'accès
      if (err.response?.status === 404 && err.response?.data?.code === 'EMAIL_NOT_FOUND') {
        setStep('access_request');
      } else {
        toast.error(err.response?.data?.error || 'Erreur lors de l\'envoi');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Connexion — Nova Copro</title>
        <meta name="description" content="Accédez à votre espace documentaire copropriété" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className="min-h-screen flex">
        {/* Panneau gauche */}
        <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-brand-900 via-brand-800 to-brand-600 flex-col justify-between p-12 relative overflow-hidden">
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

        {/* Panneau droit */}
        <div className="w-full lg:w-1/2 flex flex-col items-center justify-center p-6 lg:p-12 bg-gray-50">
          <div className="lg:hidden mb-10 bg-gradient-to-br from-brand-900 to-brand-600 rounded-2xl px-6 py-4">
            <Logo size="sm" />
          </div>

          <div className="w-full max-w-sm">

            {/* ── Email ── */}
            {step === 'email' && (
              <div>
                <h1 className="text-2xl font-bold text-gray-900 mb-2">Connexion</h1>
                <p className="text-gray-500 mb-8">
                  Saisissez votre email pour recevoir un code de connexion.
                </p>
                <form onSubmit={handleSendCode} className="space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Adresse email</label>
                    <div className="relative">
                      <Mail size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input type="email" value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="votre@email.com"
                        className="input-field pl-10"
                        required autoFocus autoComplete="email" disabled={loading} />
                    </div>
                  </div>

                  <label className="flex items-center gap-3 cursor-pointer group">
                    <div onClick={() => setRememberMe(!rememberMe)}
                      className={`w-5 h-5 rounded flex items-center justify-center border-2 transition-all flex-shrink-0
                        ${rememberMe ? 'bg-brand-600 border-brand-600' : 'border-gray-300 group-hover:border-brand-400'}`}>
                      {rememberMe && (
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                    <span className="text-sm text-gray-600 select-none">Rester connecté (6 mois)</span>
                  </label>

                  <button type="submit" disabled={loading || !email}
                    className="btn-primary w-full flex items-center justify-center gap-2">
                    {loading
                      ? <RefreshCw size={18} className="animate-spin" />
                      : <><span>Recevoir mon code</span><ArrowRight size={18} /></>
                    }
                  </button>
                </form>
              </div>
            )}

            {/* ── OTP ── */}
            {step === 'otp' && (
              <div>
                <button onClick={() => { setStep('email'); setOtp(''); }}
                  className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6 -ml-1 transition-colors">
                  ← Changer d'email
                </button>
                <h1 className="text-2xl font-bold text-gray-900 mb-2">Code de vérification</h1>
                <p className="text-gray-500 mb-1">Nous avons envoyé un code à 6 chiffres à</p>
                <p className="text-brand-600 font-semibold mb-8 truncate">{email}</p>

                <div className="mb-6">
                  <OTPInput value={otp} onChange={setOtp} disabled={loading} />
                </div>

                <button onClick={handleVerify} disabled={loading || otp.length < 6}
                  className="btn-primary w-full flex items-center justify-center gap-2 mb-4">
                  {loading
                    ? <RefreshCw size={18} className="animate-spin" />
                    : <><CheckCircle size={18} /><span>Confirmer la connexion</span></>
                  }
                </button>

                <div className="text-center mb-3">
                  {countdown > 0 ? (
                    <p className="text-sm text-gray-400">
                      Renvoyer dans <span className="font-semibold text-gray-600">{countdown}s</span>
                    </p>
                  ) : (
                    <button onClick={handleSendCode} disabled={loading}
                      className="text-sm text-brand-600 hover:text-brand-700 font-medium transition-colors">
                      Renvoyer le code
                    </button>
                  )}
                </div>

                <p className="text-xs text-gray-400 text-center">
                  Vérifiez aussi vos spams et courriers indésirables.
                </p>
              </div>
            )}

            {/* ── Demande d'accès ── */}
            {step === 'access_request' && (
              <AccessRequestStep
                email={email}
                onBack={() => setStep('email')}
              />
            )}

          </div>
        </div>
      </div>
    </>
  );
}
