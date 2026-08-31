const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const TOKEN_PATH = path.join(app.getPath('userData'), 'token.json');

function saveToken(token, userData) {
  // JWT-г найдваргүй эх сурвалжаас (deep-link garenamn://auth?token=...) авч болзошгүй тул
  // 3 хэсэгтэй, payload нь зөв JSON, exp талбартай эсэхийг шалгана — гэмтэлтэй token uncaught throw хийхээс сэргийлнэ.
  let payload;
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) throw new Error('malformed jwt');
    payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    if (!payload || typeof payload !== 'object' || !payload.exp) throw new Error('invalid payload');
  } catch (e) {
    throw new Error('Буруу нэвтрэх токен');
  }
  // userData байвал бүрэн хэрэглэгчийн мэдээлэл хадгална (avatar_url, email, wins, losses г.м.)
  const user = userData ? { ...payload, ...userData } : payload;
  fs.writeFileSync(TOKEN_PATH, JSON.stringify({ token, user }), 'utf-8');
}

function updateUser(updates) {
  try {
    const data = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
    data.user = { ...data.user, ...updates };
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(data), 'utf-8');
    return data.user;
  } catch { return null; }
}

function getToken() {
  try {
    const data = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
    // Token хэт том бол (avatar_url хадгалагдсан хуучин token) устга
    if (data.token.length > 8000) {
      clearToken();
      return null;
    }
    // Token хугацаа шалгах
    const payload = JSON.parse(Buffer.from(data.token.split('.')[1], 'base64').toString());
    if (payload.exp * 1000 < Date.now()) {
      clearToken();
      return null;
    }
    return data.token;
  } catch {
    return null;
  }
}

function getUser() {
  try {
    const data = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
    return data.user || null;
  } catch {
    return null;
  }
}

function clearToken() {
  try {
    fs.unlinkSync(TOKEN_PATH);
  } catch {}
}

module.exports = { saveToken, getToken, getUser, updateUser, clearToken };
