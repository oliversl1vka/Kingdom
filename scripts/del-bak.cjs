const fs = require('fs');
const bak = 'packages/ui/src/engine/pixel-characters.ts.bak';
if (fs.existsSync(bak)) { fs.unlinkSync(bak); console.log('Deleted .bak'); }
else console.log('No .bak found');
