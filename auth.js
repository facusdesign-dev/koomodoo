window.AuthModule = (() => {
  const sanitizeText = (value, max = 500) => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
  const sanitizeUsername = value => sanitizeText(value, 30).toLowerCase();
  const normalizePhone = value => sanitizeText(value, 40).replace(/[^+0-9 ()-]/g, '');
  const isProfileComplete = user => !!(user?.firstName?.trim() && /^[a-z0-9_]{3,30}$/.test(user?.username || ''));
  async function validateUsername(value, userId) {
    const username = sanitizeUsername(value);
    if (!/^[a-z0-9_]{3,30}$/.test(username)) return { ok: false, message: 'Usá entre 3 y 30 letras, números o guion bajo, sin espacios.' };
    const sb = getSB();
    if (!sb) return { ok: false, message: 'No hay conexión con la base de datos.' };
    try {
      const { data, error } = await sb.from('public_profiles').select('id').eq('username', username).limit(1);
      if (error) throw error;
      return data?.some(row => row.id !== userId) ? { ok: false, message: 'Ese usuario ya esta ocupado.' } : { ok: true };
    } catch (error) {
      console.error('[KMD] validateUsername:', error);
      return { ok: false, message: 'No se pudo verificar el usuario. Intentá nuevamente.' };
    }
  }
  async function withButton(id, label, action) {
    const btn = document.getElementById(id);
    if (btn?.disabled) return;
    if (btn) { btn.disabled = true; btn.textContent = 'Procesando...'; }
    try { return await action(); }
    finally { if (btn) { btn.disabled = false; btn.textContent = label; } }
  }
  return { sanitizeText, sanitizeUsername, normalizePhone, isProfileComplete, validateUsername, withButton };
})();
