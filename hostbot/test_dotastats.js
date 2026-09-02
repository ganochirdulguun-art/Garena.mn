const { decodeDotaStats } = require("./dotaStats.js");
// Синтетик w3mmd action-ууд (w3gjs-ийн гаргадаг хэлбэрээр). Бодит DotA формат (2026-09-02 relay capture):
// missionKey = ӨНГӨ (1-5 Sentinel, 7-11 Scourge), key "id" = 1-10 DotA дугаар, "9" = hero код.
const mmd = (missionKey, key, value) => ({ id: 0x6b, filename: "dr.x", missionKey, key, value });
const actions = [
  // Өнгө 1 (Sentinel): 8/2/12, creep 145, neutral 30, gold 3200, id=1
  mmd("1","1",8), mmd("1","2",2), mmd("1","5",12), mmd("1","3",145), mmd("1","7",30), mmd("1","6",3200), mmd("1","4",7),
  mmd("1","9", Buffer.from("rDr1").readUInt32LE(0)),  // hero code
  mmd("1","id",1),
  // Өнгө 7 (Scourge-ийн эхний слот): 3/9/5, creep 60, id=6
  mmd("7","1",3), mmd("7","2",9), mmd("7","5",5), mmd("7","3",60), mmd("7","id",6),
  // Өнгө 11 (Scourge-ийн сүүлийн слот) — хоосон слот, зөвхөн gold хуримтлагдсан (active биш байх ёстой)
  mmd("11","6",1514),
  // Global winner + Data event
  mmd("Global","Winner",2), mmd("Data","CSK1",145),
  // dr.x биш action (алгасах ёстой)
  { id: 0x6b, filename: "other.x", missionKey: "1", key: "1", value: 999 },
];
const r = decodeDotaStats(actions);
let ok=0, fail=0;
const chk=(n,c)=>{ if(c){ok++;console.log("PASS "+n)}else{fail++;console.log("FAIL "+n)} };
const p1=r.players.find(p=>p.colour===1), p7=r.players.find(p=>p.colour===7), p11=r.players.find(p=>p.colour===11);
chk("өнгө 1 K/D/A = 8/2/12", p1.kills===8&&p1.deaths===2&&p1.assists===12);
chk("өнгө 1 creep=145 denies=7 neutral=30 gold=3200", p1.creepKills===145&&p1.creepDenies===7&&p1.neutralKills===30&&p1.gold===3200);
chk("өнгө 1 dotaId=1 (id key), team sentinel, active", p1.dotaId===1&&p1.team==="sentinel"&&p1.active===true);
chk("өнгө 7 K/D/A = 3/9/5, dotaId=6, team scourge", p7.kills===3&&p7.deaths===9&&p7.assists===5&&p7.dotaId===6&&p7.team==="scourge");
chk("өнгө 11 scourge жагсаалтад орсон (11 алгасагдахгүй), active биш", r.scourge.some(p=>p.colour===11)&&p11.active===false);
chk("Sentinel 1, Scourge 2", r.sentinel.length===1&&r.scourge.length===2);
chk("Global winner=2 → 'scourge'", r.meta.Winner===2&&r.winner==="scourge");
chk("other.x алгассан (999 орж ирээгүй)", p1.kills!==999);
chk("hero код гарсан", typeof p1.hero==="string"&&p1.hero.length>0);
console.log("hero:", p1.hero, "| нийт event:", r.eventCount);
console.log("\n=== ДҮН: "+ok+" PASS, "+fail+" FAIL ===");
console.log("\nЖишээ гаралт (өнгө 1):", JSON.stringify(p1));
process.exit(fail===0?0:1);
