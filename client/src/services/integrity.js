'use strict';
// ── WC3 бүрэн бүтэн байдлын шалгалт (2026-10-04, эзэн: maphack-ийг найдвартай барих) ──
// 1) war3.exe-д ачаалагдсан DLL-ийн жагсаалт — нэр сольсон / өөрөө хаагддаг loader-ийн DLL-ийг барина.
// 2) Game.dll-ийн .text (код) хэсгийг санах ойгоос уншиж диск дээрх файлтай харьцуулна — maphack кодыг засдаг
//    (patch) тул ямар ч нэртэй, DLL нь хаагдсан байсан ч илэрнэ. Relocation-той байтыг тооцохгүй.
// Тоглоомд ХҮРЭХГҮЙ (зөвхөн уншина), main процессыг блоклохгүй (тусдаа 32-бит PowerShell). Шийтгэл өгөхгүй —
// илэрвэл серверт «хэрэг» нээгдэж ЭЗЭН/ADMIN шалгана (acCases.js).
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

// PowerShell 5.1 / C# 5 (ASCII зөвхөн — PS UTF-8 BOM-гүй файлыг ANSI гэж уншдаг)
const PS = String.raw`$ErrorActionPreference = 'Stop'
$code = @'
using System; using System.IO; using System.Text; using System.Diagnostics; using System.Runtime.InteropServices; using System.Collections.Generic;
public static class GmnIntegrity {
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(int access, bool inherit, int pid);
  [DllImport("kernel32.dll")] static extern bool ReadProcessMemory(IntPtr h, IntPtr addr, byte[] buf, int size, out int read);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  static string Esc(string s) { return s == null ? "" : s.Replace("\\", "\\\\").Replace("\"", "\\\""); }
  static string Hex(byte[] b, long o, int n) { StringBuilder sb = new StringBuilder(); for (int i = 0; i < n && o + i < b.Length; i++) sb.Append(b[o + i].ToString("x2")); return sb.ToString(); }
  public static string Run() {
    Process p = null;
    foreach (string nm in new string[] { "war3", "Warcraft III" }) { Process[] a = Process.GetProcessesByName(nm); if (a.Length > 0) { p = a[0]; break; } }
    if (p == null) return "{\"running\":false}";
    StringBuilder sb = new StringBuilder("{\"running\":true,\"pid\":" + p.Id);
    ProcessModule game = null;
    try {
      sb.Append(",\"modules\":[");
      int i = 0;
      foreach (ProcessModule m in p.Modules) {
        if (i++ > 0) sb.Append(",");
        sb.Append("\"").Append(Esc(m.FileName)).Append("\"");
        if (string.Equals(m.ModuleName, "game.dll", StringComparison.OrdinalIgnoreCase)) game = m;
      }
      sb.Append("]");
      // mod_info: product/description/company of non-Windows modules (recognize benign wrappers like ReShade d3d8to9 by content, not name)
      string win = (Environment.GetEnvironmentVariable("WINDIR") ?? "C:\\Windows").ToLowerInvariant();
      sb.Append(",\"mod_info\":{");
      int k = 0;
      foreach (ProcessModule m in p.Modules) {
        string fn = m.FileName ?? ""; if (fn.ToLowerInvariant().StartsWith(win)) continue;
        string inf = "";
        try { FileVersionInfo v = m.FileVersionInfo; inf = (v.ProductName ?? "") + " | " + (v.FileDescription ?? "") + " | " + (v.CompanyName ?? ""); } catch { }
        if (k++ > 0) sb.Append(",");
        sb.Append("\"").Append(Esc(fn)).Append("\":\"").Append(Esc(inf)).Append("\"");
      }
      sb.Append("}");
    } catch (Exception e) { sb.Append("],\"modules_error\":\"").Append(Esc(e.Message)).Append("\""); }
    if (game != null) {
      try { sb.Append(",\"game\":").Append(CheckGame(p, game)); }
      catch (Exception e) { sb.Append(",\"game\":{\"error\":\"").Append(Esc(e.Message)).Append("\"}"); }
    }
    try { sb.Append(",\"diag\":").Append(Diag(p)); } catch (Exception e) { sb.Append(",\"diag_error\":\"").Append(Esc(e.Message)).Append("\""); }
    sb.Append("}");
    return sb.ToString();
  }
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryFullProcessImageName(IntPtr h, int flags, StringBuilder buf, ref int size);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr h, uint access, out IntPtr tok);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool GetTokenInformation(IntPtr tok, int cls, out int info, int len, out int ret);
  // Diagnostics when the process cannot be read (elevated war3): who started it, compat flags, our own elevation
  static string Diag(Process p) {
    StringBuilder sb = new StringBuilder("{");
    bool selfAdmin = false;
    try { selfAdmin = new System.Security.Principal.WindowsPrincipal(System.Security.Principal.WindowsIdentity.GetCurrent()).IsInRole(System.Security.Principal.WindowsBuiltInRole.Administrator); } catch { }
    sb.Append("\"self_admin\":").Append(selfAdmin ? "true" : "false");
    string path = ""; string elev = "?";
    IntPtr h = OpenProcess(0x1000, false, p.Id);
    if (h != IntPtr.Zero) {
      try {
        StringBuilder b = new StringBuilder(1024); int n = b.Capacity;
        if (QueryFullProcessImageName(h, 0, b, ref n)) path = b.ToString();
        IntPtr tok;
        if (OpenProcessToken(h, 0x0008, out tok)) {
          int info, ret;
          if (GetTokenInformation(tok, 20, out info, 4, out ret)) elev = info != 0 ? "1" : "0";
          CloseHandle(tok);
        }
      } finally { CloseHandle(h); }
    }
    sb.Append(",\"path\":\"").Append(Esc(path)).Append("\",\"elevated\":\"").Append(elev).Append("\"");
    string parent = "";
    try {
      using (System.Management.ManagementObjectSearcher s = new System.Management.ManagementObjectSearcher("SELECT ParentProcessId FROM Win32_Process WHERE ProcessId=" + p.Id)) {
        foreach (System.Management.ManagementObject o in s.Get()) { int ppid = Convert.ToInt32(o["ParentProcessId"]); try { parent = Process.GetProcessById(ppid).ProcessName; } catch { parent = "#" + ppid + " (closed)"; } }
      }
    } catch (Exception e) { parent = "? " + e.Message; }
    sb.Append(",\"parent\":\"").Append(Esc(parent)).Append("\"");
    sb.Append(",\"compat\":[");
    int k = 0;
    foreach (Microsoft.Win32.RegistryKey root in new Microsoft.Win32.RegistryKey[] { Microsoft.Win32.Registry.CurrentUser, Microsoft.Win32.Registry.LocalMachine }) {
      try {
        using (Microsoft.Win32.RegistryKey key = root.OpenSubKey("Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers")) {
          if (key == null) continue;
          foreach (string name in key.GetValueNames()) {
            string ln = name.ToLowerInvariant();
            if (ln.Contains("war3") || ln.Contains("frozen throne") || ln.Contains("warcraft")) { if (k++ > 0) sb.Append(","); sb.Append("\"").Append(Esc(name + " = " + Convert.ToString(key.GetValue(name)))).Append("\""); }
          }
        }
      } catch { }
    }
    sb.Append("]}");
    return sb.ToString();
  }
  static uint RvaToOff(List<uint[]> secs, uint rva) { foreach (uint[] s in secs) { if (rva >= s[0] && rva < s[0] + Math.Max(s[1], s[2])) return rva - s[0] + s[3]; } return rva; }
  static string CheckGame(Process p, ProcessModule m) {
    byte[] f = File.ReadAllBytes(m.FileName);
    int pe = BitConverter.ToInt32(f, 0x3C);
    int nsec = BitConverter.ToUInt16(f, pe + 6), optSize = BitConverter.ToUInt16(f, pe + 20), opt = pe + 24;
    uint imageBase = BitConverter.ToUInt32(f, opt + 28);
    int dd = opt + 96;
    uint relocRva = BitConverter.ToUInt32(f, dd + 40), relocSize = BitConverter.ToUInt32(f, dd + 44);
    List<uint[]> secs = new List<uint[]>();
    uint tVa = 0, tVs = 0, tRaw = 0, tPtr = 0;
    for (int i = 0; i < nsec; i++) {
      int s = opt + optSize + i * 40;
      string name = Encoding.ASCII.GetString(f, s, 8).TrimEnd('\0');
      uint vs = BitConverter.ToUInt32(f, s + 8), va = BitConverter.ToUInt32(f, s + 12), raw = BitConverter.ToUInt32(f, s + 16), ptr = BitConverter.ToUInt32(f, s + 20);
      secs.Add(new uint[] { va, vs, raw, ptr });
      if (name == ".text") { tVa = va; tVs = vs; tRaw = raw; tPtr = ptr; }
    }
    if (tVa == 0) return "{\"error\":\"no .text\"}";
    long baseAddr = m.BaseAddress.ToInt64();
    bool relocated = baseAddr != (long)imageBase;
    int len = (int)Math.Min(tVs, tRaw);
    HashSet<uint> reloc = new HashSet<uint>();
    if (relocated && relocRva != 0) {
      uint off = RvaToOff(secs, relocRva), end = off + relocSize;
      while (off + 8 <= end && off + 8 <= f.Length) {
        uint page = BitConverter.ToUInt32(f, (int)off), bs = BitConverter.ToUInt32(f, (int)off + 4);
        if (bs < 8) break;
        for (uint k = 8; k + 1 < bs; k += 2) { ushort e = BitConverter.ToUInt16(f, (int)(off + k)); if ((e >> 12) == 3) reloc.Add(page + (uint)(e & 0xFFF)); }
        off += bs;
      }
    }
    IntPtr h = OpenProcess(0x0010 | 0x0400, false, p.Id);
    if (h == IntPtr.Zero) return "{\"error\":\"OpenProcess denied\"}";
    byte[] mem = new byte[len]; int got = 0;
    try {
      for (int o = 0; o < len; o += 0x10000) {
        int n = Math.Min(0x10000, len - o); byte[] tmp = new byte[n]; int r;
        if (ReadProcessMemory(h, new IntPtr(baseAddr + tVa + o), tmp, n, out r) && r > 0) { Buffer.BlockCopy(tmp, 0, mem, o, r); got += r; }
      }
    } finally { CloseHandle(h); }
    if (got < len) return "{\"error\":\"partial read " + got + "/" + len + "\"}";
    bool[] masked = new bool[len];
    foreach (uint rva in reloc) { if (rva >= tVa && rva + 4 <= tVa + len) for (int z = 0; z < 4; z++) masked[rva - tVa + z] = true; }
    int diffBytes = 0, nreg = 0, i2 = 0;
    StringBuilder regs = new StringBuilder();
    while (i2 < len) {
      if (!masked[i2] && mem[i2] != f[tPtr + i2]) {
        int st = i2, last = i2;
        while (i2 < len && i2 - last <= 16) { if (!masked[i2] && mem[i2] != f[tPtr + i2]) { last = i2; diffBytes++; } i2++; }
        int rl = last - st + 1;
        if (nreg < 30) {
          if (nreg > 0) regs.Append(",");
          regs.Append("{\"rva\":\"").Append((tVa + st).ToString("x")).Append("\",\"len\":").Append(rl)
              .Append(",\"file\":\"").Append(Hex(f, tPtr + st, Math.Min(rl, 16))).Append("\",\"mem\":\"").Append(Hex(mem, st, Math.Min(rl, 16))).Append("\"}");
        }
        nreg++; i2 = last + 1;
      } else i2++;
    }
    string ver = ""; try { ver = FileVersionInfo.GetVersionInfo(m.FileName).FileVersion; } catch { }
    return "{\"path\":\"" + Esc(m.FileName) + "\",\"version\":\"" + Esc(ver) + "\",\"base\":\"" + baseAddr.ToString("x") + "\",\"relocated\":" + (relocated ? "true" : "false")
      + ",\"text_len\":" + len + ",\"diff_bytes\":" + diffBytes + ",\"regions\":" + nreg + ",\"diffs\":[" + regs.ToString() + "]}";
  }
}
'@
Add-Type -TypeDefinition $code -Language CSharp -ReferencedAssemblies System.Management
[Console]::Out.Write([GmnIntegrity]::Run())
`;

let _scriptPath = null;
function scriptPath(dir) {
  const p = path.join(dir, 'gmn-integrity-v3.ps1');
  if (_scriptPath === p && fs.existsSync(p)) return p;
  fs.writeFileSync(p, PS.replace(/\r?\n/g, '\r\n'), 'ascii');
  _scriptPath = p; return p;
}
function ps32() {
  const w = process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows';
  const wow = path.join(w, 'SysWOW64', 'WindowsPowerShell', 'v1.0', 'powershell.exe');   // war3.exe 32-бит → модулиудыг зөв жагсаана
  return fs.existsSync(wow) ? wow : path.join(w, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}
/** Шалгалт ажиллуулна → { running, modules[], game{diff_bytes,…} } эсвэл null (алдаа/timeout). Хэзээ ч throw хийхгүй. */
function probe(dir) {
  return new Promise((resolve) => {
    let file; try { file = scriptPath(dir); } catch { return resolve(null); }
    try {
      execFile(ps32(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file],
        { windowsHide: true, timeout: 90000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' },
        (err, stdout) => {
          if (err && !stdout) return resolve(null);
          const line = String(stdout || '').trim().split(/\r?\n/).filter((l) => l.startsWith('{')).pop();
          try { resolve(line ? JSON.parse(line) : null); } catch { resolve(null); }
        });
    } catch { resolve(null); }
  });
}

// ── DLL-ийн жагсаалтыг үнэлэх ──
// blizzard.ax — Blizzard-ийн өөрийн DirectShow (cinematic) шүүлтүүр; «танигдаагүй DLL» гэж андуурч хэрэг нээгдсэн (911, 2026-10-04)
const WC3_LEGIT = /^((game|storm|mss32|ijl15|smackw32|binkw32|war3|frozen throne|warcraft iii)\.(dll|exe)|blizzard\.ax)$/i;
const MILES_EXT = /\.(asi|m3d|flt|mix)$/i;
// Overlay, драйвер, бичлэг, дэлгэцийн засвар — гэмгүй гэж тооцох нэрс
const BENIGN = /(crosire|dege|discord|graphics-hook|gameoverlayrenderer|rtsshooks|rtss|nvspcap|nvd3dum|nvwgf|nvldumd|nvumdshim|nvapi|nvoglv|nvinit|igd|igc|ig\d|igxe|atidxx|aticfx|atiu|atiogl|amdxx|amdenc|amdihk|amdvlk|bdcam|fraps|warkey|garena|obs|medal|overwolf|xsplit|mirillis|action_x86|nahimic|sonic|a3d|asus|logi|razer|steelseries|corsair|msi|afterburner|reshade|dxwrapper|d3d8to9|dgvoodoo|ddraw|wined3d|opengl32|libglesv2|libegl|mumble|teamspeak|ts3|vivox|overlay|hook32)/i;

/** modules[] → { blocked: [нэр] (хориотой нэр таарсан), unknown: [зам] (системийн бус, танигдаагүй) } */
function classifyModules(mods, blocklist, wc3Dir, info = {}) {
  const W = String(process.env.WINDIR || 'C:\\Windows').toLowerCase();
  const PF = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramW6432].filter(Boolean).map((x) => x.toLowerCase());
  const dir = String(wc3Dir || '').toLowerCase();
  const blocked = [], unknown = [];
  for (const full of mods || []) {
    const lf = String(full).toLowerCase(); const base = path.win32.basename(lf);
    if ((blocklist || []).some((sig) => sig && base.includes(sig))) { blocked.push(path.win32.basename(full)); continue; }
    if (lf.startsWith(W + '\\')) continue;
    if (WC3_LEGIT.test(base) || MILES_EXT.test(base)) continue;
    if (BENIGN.test(base)) continue;
    const inf = String((info || {})[full] || '');
    if (inf && (blocklist || []).some((sig) => sig && inf.toLowerCase().includes(sig))) { blocked.push(path.win32.basename(full)); continue; }
    if (inf && BENIGN.test(inf)) continue;   // бүтээгдэхүүний нэрээр (ReShade / d3d8to9 / dgVoodoo …) — 2026-10-04
    if (PF.some((p) => lf.startsWith(p + '\\')) && !(dir && lf.startsWith(dir + '\\'))) continue;   // Program Files-ийн бусад програм (WC3 хавтсаас бусад)
    unknown.push(full);
  }
  return { blocked, unknown: unknown.slice(0, 40) };
}

/** «Шалгах боломжгүй» (elevated WC3) үеийн шалтгааныг хүнд ойлгомжтой нэг мөрөөр — тоглогчид ба ADMIN-д (2026-10-09). */
function blindCause(d = {}) {
  const compat = (Array.isArray(d.compat) ? d.compat : []).map(String);
  const ra = compat.find((c) => /RUNASADMIN|ELEVATECREATEPROCESS/i.test(c));
  if (ra) return `«Run as administrator» тохиргоотой: ${ra.split(' = ')[0].split(/[\\/]/).pop()}`;
  const par = String(d.parent || '').trim();
  if (par && !/^(frozen throne|warcraft iii|war3|garena\.mn|#\d+)/i.test(par)) return `WC3-ийг өөр програм нээсэн: ${par}`;
  if (d.elevated === '0') return 'WC3 администраторын эрхгүй ч уншигдсангүй — антивирус/хамгаалалтын програм хаасан байж магадгүй';
  if (d.self_admin) return 'Garena.mn өөрөө администраторын эрхтэй ч WC3 уншигдсангүй';
  return 'WC3 администраторын эрхээр ажиллаж байна' + (par ? ` (нээсэн: ${par})` : '');
}

module.exports = { probe, classifyModules, blindCause, _PS: PS };
