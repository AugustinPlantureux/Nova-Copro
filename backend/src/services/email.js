const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

// ── Échappement HTML (données utilisateur dans les emails) ──
const esc = (s) => String(s || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');


// ── Templates communs ─────────────────────────────────────────

const header = `
  <tr>
    <td style="background:linear-gradient(135deg,#1a3a5c 0%,#2563eb 100%);padding:32px 40px;text-align:center;">
      <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">🏢 Nova Copro</h1>
      <p style="margin:6px 0 0;color:rgba(255,255,255,0.8);font-size:13px;letter-spacing:1px;text-transform:uppercase;">Espace Copropriétaires</p>
    </td>
  </tr>`;

const footer = `
  <tr>
    <td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #e5e7eb;">
      <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;line-height:1.6;">
        Nova Copro – Gestion de copropriétés<br>
        Cet email a été envoyé automatiquement, merci de ne pas y répondre.
      </p>
    </td>
  </tr>`;

const wrap = (body) => `
<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f6f9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6f9;padding:40px 0;">
    <tr><td align="center">
      <table width="580" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 20px rgba(0,0,0,0.08);">
        ${header}${body}${footer}
      </table>
    </td></tr>
  </table>
</body></html>`;

// ── OTP ───────────────────────────────────────────────────────

const sendOTP = async (email, code, prenom = null) => {
  const greeting = prenom ? `Bonjour ${esc(prenom)},` : 'Bonjour,';

  const html = wrap(`
  <tr><td style="padding:40px 40px 32px;">
    <p style="margin:0 0 16px;color:#374151;font-size:16px;line-height:1.6;">${greeting}</p>
    <p style="margin:0 0 28px;color:#374151;font-size:16px;line-height:1.6;">
      Voici votre code de connexion à l'espace documentaire Nova Copro :
    </p>
    <div style="background:#f0f7ff;border:2px dashed #2563eb;border-radius:10px;padding:24px;text-align:center;margin:0 0 28px;">
      <p style="margin:0 0 8px;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:1px;">Votre code</p>
      <p style="margin:0;color:#1a3a5c;font-size:42px;font-weight:800;letter-spacing:8px;font-family:monospace;">${code}</p>
    </div>
    <p style="margin:0 0 16px;color:#6b7280;font-size:14px;line-height:1.6;">
      ⏱️ Ce code est valable pendant <strong>10 minutes</strong>.
    </p>
    <p style="margin:0;color:#6b7280;font-size:14px;line-height:1.6;">
      Si vous n'avez pas demandé ce code, vous pouvez ignorer cet email.
    </p>
  </td></tr>`);

  try {
    const result = await resend.emails.send({
      from:    process.env.EMAIL_FROM,
      to:      email,
      subject: `${code} – Votre code de connexion Nova Copro`,
      html,
    });
    console.log(`✉️ OTP envoyé à ${email}`, result.id);
    return result;
  } catch (err) {
    console.error('❌ Erreur envoi OTP:', err);
    throw new Error('Impossible d\'envoyer l\'email. Veuillez réessayer.');
  }
};

// ── Demande d'accès ───────────────────────────────────────────
// Envoie deux emails :
//   1. À l'admin Nova Copro : notification avec l'email demandeur + message libre
//   2. À l'utilisateur demandeur : confirmation de réception

const sendAccessRequest = async (requesterEmail, message = '') => {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) throw new Error('ADMIN_EMAIL non configuré');

  const now = new Date().toLocaleString('fr-FR', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris',
  });

  // Email à l'admin
  const adminHtml = wrap(`
  <tr><td style="padding:40px 40px 32px;">
    <p style="margin:0 0 20px;color:#374151;font-size:16px;line-height:1.6;">
      Une nouvelle demande d'accès a été soumise sur Nova Copro.
    </p>
    <div style="background:#f0f9ff;border-left:4px solid #2563eb;border-radius:6px;padding:20px 24px;margin:0 0 24px;">
      <p style="margin:0 0 8px;color:#374151;font-size:14px;">
        <strong>Email :</strong> <a href="mailto:${esc(requesterEmail)}" style="color:#2563eb;">${esc(requesterEmail)}</a>
      </p>
      <p style="margin:0 0 8px;color:#374151;font-size:14px;">
        <strong>Date :</strong> ${now}
      </p>
      ${message ? `<p style="margin:8px 0 0;color:#374151;font-size:14px;"><strong>Message :</strong> ${esc(message)}</p>` : ''}
    </div>
    <p style="margin:0;color:#6b7280;font-size:14px;line-height:1.6;">
      Pour donner accès à ce copropriétaire, ajoutez-le dans l'interface d'administration Nova Copro.
    </p>
  </td></tr>`);

  // Email de confirmation au demandeur
  const requesterHtml = wrap(`
  <tr><td style="padding:40px 40px 32px;">
    <p style="margin:0 0 20px;color:#374151;font-size:16px;line-height:1.6;">Bonjour,</p>
    <p style="margin:0 0 20px;color:#374151;font-size:16px;line-height:1.6;">
      Votre demande d'accès à l'espace documentaire Nova Copro a bien été reçue.
    </p>
    <div style="background:#f0fdf4;border-left:4px solid #16a34a;border-radius:6px;padding:16px 20px;margin:0 0 24px;">
      <p style="margin:0;color:#374151;font-size:14px;">
        ✅ Votre demande a été transmise au gestionnaire de votre copropriété.
        Vous recevrez un email dès que votre accès sera configuré.
      </p>
    </div>
    <p style="margin:0;color:#6b7280;font-size:14px;line-height:1.6;">
      Si vous n'avez pas effectué cette demande, vous pouvez ignorer cet email.
    </p>
  </td></tr>`);

  await Promise.all([
    resend.emails.send({
      from:    process.env.EMAIL_FROM,
      to:      adminEmail,
      subject: `Demande d'accès Nova Copro — ${requesterEmail}`,
      html:    adminHtml,
    }),
    resend.emails.send({
      from:    process.env.EMAIL_FROM,
      to:      requesterEmail,
      subject: 'Votre demande d\'accès Nova Copro',
      html:    requesterHtml,
    }),
  ]);

  console.log(`📩 Demande d'accès reçue de ${requesterEmail}`);
};

module.exports = { sendOTP, sendAccessRequest };
