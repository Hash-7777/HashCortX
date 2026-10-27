// Grows the task's project into a large one: a booking app's many other
// screens, routes, models and notes, all invented and none about pricing,
// and a folder of dependencies and a build output that both name what the
// task is about, which a search of the project should leave out. The same
// files every time. Run by run.mjs with the project's folder.
import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2];
if (!root) { console.error('grow.mjs needs the project folder'); process.exit(2); }
const put = (rel, text) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
const pad = (n) => String(n).padStart(3, '0');
const areas = ['guests', 'rooms', 'housekeeping', 'staff', 'reviews', 'calendar', 'messages', 'reports', 'inventory', 'events'];

for (let i = 0; i < 80; i++) {
  const area = areas[i % areas.length];
  put(`server/routes/${area}/handler${pad(i)}.js`, `// The ${area} route ${i}.\nfunction handle${area[0].toUpperCase()}${area.slice(1)}${i}(req) {\n  return { ok: true, area: '${area}', id: req.id, booking: req.booking || null };\n}\n\nmodule.exports = { handle${area[0].toUpperCase()}${area.slice(1)}${i} };\n`);
}
for (let i = 0; i < 40; i++) {
  const area = areas[i % areas.length];
  put(`server/models/${area}${pad(i)}.js`, `// A ${area} record.\nclass ${area[0].toUpperCase()}${area.slice(1)}Record${i} {\n  constructor(fields) { this.fields = fields; }\n  nightsBooked() { return this.fields.nights || 0; }\n}\n\nmodule.exports = { ${area[0].toUpperCase()}${area.slice(1)}Record${i} };\n`);
}
for (let i = 0; i < 120; i++) {
  const area = areas[i % areas.length];
  put(`web/src/components/${area}/Panel${pad(i)}.js`, `// The ${area} panel ${i} of the front desk screen.\nfunction renderPanel${i}(state) {\n  return '<section class="${area}">' + (state.title || '${area}') + '</section>';\n}\n\nmodule.exports = { renderPanel${i} };\n`);
}
for (let i = 0; i < 30; i++) put(`docs/${areas[i % areas.length]}-${pad(i)}.md`, `# ${areas[i % areas.length]} notes ${i}\n\nHow the front desk handles ${areas[i % areas.length]}. A stay is booked from the calendar.\n`);

// Noise a search of the project should not be drowned in.
for (let i = 0; i < 25; i++) put(`node_modules/rate-helpers/lib/part${pad(i)}.js`, `// A dependency.\nfunction stayTotal(a, b) { return a * b; }\nmodule.exports = { stayTotal, nightlyPrice: (r) => r };\n`);
put('dist/app.bundle.js', Array.from({ length: 400 }, (_, i) => `function stayTotal${i}(r,n){return r.rate*n}var nightlyPrice${i}=1;`).join('\n'));
put('.gitignore', 'node_modules/\ndist/\nlogs/\n');
put('logs/today.txt', 'stayTotal called 40 times\n'.repeat(50));
