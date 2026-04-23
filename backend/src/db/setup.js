require('dotenv').config();
const { setup } = require('./index');

(async () => {
  console.log('🚀 Initialisation de la base de données Nova Copro...');
  try {
    await setup();
    console.log('✅ Base de données initialisée');
    process.exit(0);
  } catch (err) {
    console.error('❌ Échec initialisation:', err);
    process.exit(1);
  }
})();
