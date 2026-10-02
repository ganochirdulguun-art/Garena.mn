const f=JSON.parse(require('fs').readFileSync(__dirname+'/findings.json','utf8'));
for(const pat of process.argv.slice(2)){ const [file,line]=pat.split(':'); const m=f.filter(x=>x.file.endsWith(file)&&(!line||Math.abs(x.line-Number(line))<8));
 for(const x of m) console.log(`\n### ${x.file}:${x.line} [${x.severity}] ${x.title}\nDESC: ${x.description}\nSCENARIO: ${x.failure_scenario}\nEVID: ${String(x.evidence).slice(0,500)}\nFIX: ${x.fix_suggestion}`); }
