window.SearchModule = (() => {
  let timer = null;

  function close() {
    const dd = document.getElementById('global-search-dd');
    if (dd) {
      dd.innerHTML = '';
      dd.classList.remove('open');
    }
  }

  function render(results) {
    const dd = document.getElementById('global-search-dd');
    if (!dd) return;
    if (!results.length) {
      dd.innerHTML = '<div class="gs-empty">Sin resultados</div>';
      dd.classList.add('open');
      return;
    }
    dd.innerHTML = results.map(item => {
      if (item.kind === 'profile') {
        return `<button class="gs-item" onclick="openSearchResult('profile','${item.id}')"><div class="gs-emoji">${item.avatar_html}</div><div class="gs-body"><div class="gs-title">${item.title}</div><div class="gs-sub">@${item.username || 'usuario'} · Perfil</div></div></button>`;
      }
      return `<button class="gs-item" onclick="openSearchResult('product','${item.id}')"><div class="gs-emoji">${item.emoji}</div><div class="gs-body"><div class="gs-title">${item.title}</div><div class="gs-sub">${item.subtitle}</div></div></button>`;
    }).join('');
    dd.classList.add('open');
  }

  async function searchAll(term) {
    const q = AuthModule.sanitizeText(term, 60);
    if (q.length < 2) {
      close();
      return [];
    }
    const sb = getSB();
    if (!sb) return [];
    const [profilesRes, productsRes] = await Promise.all([
      sb.from('profiles').select('id, first_name, username, avatar_url').or(`username.ilike.%${q}%,first_name.ilike.%${q}%,email.ilike.%${q}%`).limit(5),
      sb.from('products').select('id, title, price, image_url').ilike('title', `%${q}%`).limit(5),
    ]);
    if (profilesRes.error) {
      console.error('[KMD] search profiles:', profilesRes.error);
      return [];
    }
    if (productsRes.error) {
      console.error('[KMD] search products:', productsRes.error);
      return [];
    }
    const profileItems = (profilesRes.data || []).map(row => ({
      kind: 'profile',
      id: row.id,
      title: row.first_name || row.username || 'Perfil',
      username: row.username || '',
      avatar_html: row.avatar_url ? `<img src="${row.avatar_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : '👤',
    }));
    const productItems = (productsRes.data || []).map(row => ({
      kind: 'product',
      id: String(row.id),
      title: row.title || 'Producto',
      subtitle: typeof fmt === 'function' ? fmt(Number(row.price || 0)) : `$${row.price || 0}`,
      emoji: row.image_url ? `<img src="${row.image_url}" style="width:100%;height:100%;object-fit:cover;border-radius:12px">` : '🛍️',
    }));
    const results = [...profileItems, ...productItems];
    render(results);
    return results;
  }

  function queue(term) {
    clearTimeout(timer);
    timer = setTimeout(() => { searchAll(term).catch(err => { console.error('[KMD] search:', err); close(); }); }, 300);
  }

  return { queue, searchAll, close };
})();
