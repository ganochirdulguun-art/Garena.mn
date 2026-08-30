// Windows Firewall тохиргоо — WC3 LAN (порт 6112) + тоглоомын exe дүрмүүд.
// (Өмнө нь zerotier.js дотор байсан; ZeroTier 2026-08-30-нд бүрэн хасагдахад
//  галт ханын хэсэг нь бот-хостын LAN харагдацад хэрэгтэй хэвээр тул энд үлдэв.)
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

function isFirewallReady() {
  try {
    const out = execSync('netsh advfirewall firewall show rule name="WC3 LAN UDP In"',
      { stdio: 'pipe', encoding: 'utf8', timeout: 5000 });
    return out.includes('WC3 LAN UDP In');
  } catch { return false; }
}

function isFirewallRuleReady(ruleName) {
  try {
    const out = execSync(`netsh advfirewall firewall show rule name="${ruleName}"`,
      { stdio: 'pipe', encoding: 'utf8', timeout: 5000 });
    return out.includes(ruleName);
  } catch { return false; }
}

function isGameFirewallReady(gamePaths) {
  const paths = (gamePaths || []).filter((gamePath) => gamePath && fs.existsSync(gamePath));
  if (!paths.length) return true;
  return paths.every((gamePath) => {
    const gameName = path.basename(gamePath, path.extname(gamePath));
    return isFirewallRuleReady(`MongolWC3 Game - ${gameName}`);
  });
}

// Windows Firewall: порт 6112 + тоглоомын exe дүрмүүд (нэг UAC prompt-оор)
// gamePaths: тоглоомын exe файлуудын path-ын массив (optional)
// force: true бол шалгалтгүйгээр шууд тохируулна
function elevatedNetworkSetup(gamePaths, force) {
  const firewallOk = !force && isFirewallReady();
  const gameRulesOk = !force && isGameFirewallReady(gamePaths);

  if (firewallOk && gameRulesOk) {
    console.log('[Firewall] Тохиргоо аль хэдийн хийгдсэн (UAC шаардлагагүй)');
    return { firewall: true };
  }

  console.log(`[Firewall] Setup шаардлагатай: firewall=${firewallOk ? 'OK' : 'NEED'}, games=${gameRulesOk ? 'OK' : 'NEED'}`);

  try {
    const scriptDir = path.join(os.tmpdir(), 'wc3-fw-setup');
    if (!fs.existsSync(scriptDir)) fs.mkdirSync(scriptDir, { recursive: true });
    const scriptPath = path.join(scriptDir, 'network-setup.ps1');

    const lines = ['# Garena.mn — WC3 Firewall тохиргоо', ''];

    if (!firewallOk || force) {
      lines.push(
        '# Firewall: Port 6112 (WC3 LAN)',
        'netsh advfirewall firewall delete rule name="WC3 LAN UDP In" >$null 2>&1',
        'netsh advfirewall firewall delete rule name="WC3 LAN UDP Out" >$null 2>&1',
        'netsh advfirewall firewall delete rule name="WC3 LAN TCP In" >$null 2>&1',
        'netsh advfirewall firewall delete rule name="WC3 LAN TCP Out" >$null 2>&1',
        'netsh advfirewall firewall add rule name="WC3 LAN UDP In" dir=in action=allow protocol=UDP localport=6112 profile=any | Out-Null',
        'netsh advfirewall firewall add rule name="WC3 LAN UDP Out" dir=out action=allow protocol=UDP localport=6112 profile=any | Out-Null',
        'netsh advfirewall firewall add rule name="WC3 LAN TCP In" dir=in action=allow protocol=TCP localport=6112 profile=any | Out-Null',
        'netsh advfirewall firewall add rule name="WC3 LAN TCP Out" dir=out action=allow protocol=TCP localport=6112 profile=any | Out-Null',
        '',
      );
    }

    if (force || !gameRulesOk) {
      lines.push('# Firewall: Тоглоомын exe файлууд');
      for (const gamePath of gamePaths || []) {
        if (fs.existsSync(gamePath)) {
          const safePath = gamePath.replace(/'/g, "''");
          const gameName = path.basename(gamePath, path.extname(gamePath));
          lines.push(
            `netsh advfirewall firewall delete rule name="MongolWC3 Game - ${gameName}" >$null 2>&1`,
            `netsh advfirewall firewall add rule name="MongolWC3 Game - ${gameName}" dir=in action=allow program="${safePath}" profile=any | Out-Null`,
            `netsh advfirewall firewall add rule name="MongolWC3 Game - ${gameName}" dir=out action=allow program="${safePath}" profile=any | Out-Null`,
          );
        }
      }
    }

    fs.writeFileSync(scriptPath, lines.join('\r\n'), 'utf8');

    execSync(
      `powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File','${scriptPath}' -Verb RunAs -Wait -WindowStyle Hidden"`,
      { stdio: 'pipe', timeout: 20000 }
    );

    console.log('[Firewall] Тохиргоо хийгдлээ (port 6112 + games)');
    try { fs.rmSync(scriptDir, { recursive: true, force: true }); } catch {}
    return { firewall: true };
  } catch (e) {
    console.warn('[Firewall] Elevated setup алдаа:', e.message);
    return { firewall: false };
  }
}

module.exports = {
  isFirewallReady, isFirewallRuleReady, isGameFirewallReady, elevatedNetworkSetup,
};
