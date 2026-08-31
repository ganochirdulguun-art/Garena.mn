const { decodeDotaStats } = require("C:/Users/Gan-Ochir/Gan-Ochir repo/Garena.mn/hostbot/dotaStats.js");
// Синтетик w3mmd action-ууд (w3gjs-ийн гаргадаг хэлбэрээр)
const mmd = (missionKey, key, value) => ({ id: 0x6b, filename: "dr.x", missionKey, key, value });
const actions = [
  // Тоглогч 1 (Sentinel): 8/2/12, creep 145, neutral 30, gold 3200
  mmd("1","1",8), mmd("1","2",2), mmd("1","5",12), mmd("1","3",145), mmd("1","7",30), mmd("1","6",3200), mmd("1","4",7),
  mmd("1","9", Buffer.from("rDr1").readUInt32LE(0)),  // hero code
  // Тоглогч 6 (Scourge): 3/9/5, creep 60
  mmd("6","1",3), mmd("6","2",9), mmd("6","5",5), mmd("6","3",60),
  // Global winner + Data event
  mmd("Global","Winner",1), mmd("Data","1",6),
  // dr.x биш action (алгасах ёстой)
  { id: 0x6b, filename: "other.x", missionKey: "1", key: "1", value: 999 },
];
const r = decodeDotaStats(actions);
let ok=0, fail=0;
const chk=(n,c)=>{ if(c){ok++;console.log("PASS "+n)}else{fail++;console.log("FAIL "+n)} };
const p1=r.players.find(p=>p.dotaId===1), p6=r.players.find(p=>p.dotaId===6);
chk("тоглогч 1 K/D/A = 8/2/12", p1.kills===8&&p1.deaths===2&&p1.assists===12);
chk("тоглогч 1 creep=145 denies=7 neutral=30 gold=3200", p1.creepKills===145&&p1.creepDenies===7&&p1.neutralKills===30&&p1.gold===3200);
chk("тоглогч 6 K/D/A = 3/9/5", p6.kills===3&&p6.deaths===9&&p6.assists===5);
chk("Sentinel 1, Scourge 1", r.sentinel.length===1&&r.scourge.length===1);
chk("Global winner=1", r.meta.Winner===1);
chk("other.x алгассан (999 орж ирээгүй)", p1.kills!==999);
chk("hero код гарсан", typeof p1.hero==="string"&&p1.hero.length>0);
console.log("hero:", p1.hero, "| нийт event:", r.eventCount);
console.log("\n=== ДҮН: "+ok+" PASS, "+fail+" FAIL ===");
console.log("\nЖишээ гаралт (тоглогч 1):", JSON.stringify(p1));
process.exit(fail===0?0:1);
