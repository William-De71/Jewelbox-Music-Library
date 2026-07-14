import { useState, useEffect } from 'preact/hooks';
import { Layout } from './components/Layout.jsx';
import { Dashboard } from './pages/Dashboard.jsx';
import { AlbumForm } from './pages/AlbumForm.jsx';
import { AlbumDetail } from './pages/AlbumDetail.jsx';
import { Collections } from './pages/Collections.jsx';
import { WantList } from './pages/WantList.jsx';
import { Lend } from './pages/Lend.jsx';
import { Stats } from './pages/Stats.jsx';
import { Settings } from './pages/Settings.jsx';
import { About } from './pages/About.jsx';
import { Playlists } from './pages/Playlists.jsx';

// Derive the route from the current URL (initial load, back/forward, deep links)
function routeFromLocation() {
  const path = window.location.pathname;
  const urlParams = new URLSearchParams(window.location.search);
  const params = {};

  if (path === '/add') {
    urlParams.forEach((value, key) => params[key] = value);
    return { page: 'add', params };
  }
  if (path.startsWith('/edit/')) return { page: 'edit', params: { id: path.split('/')[2] } };
  if (path.startsWith('/album/')) return { page: 'detail', params: { id: path.split('/')[2] } };
  if (path === '/collections') {
    urlParams.forEach((value, key) => params[key] = value);
    return { page: 'collections', params };
  }
  if (path === '/wantlist') {
    urlParams.forEach((value, key) => params[key] = value);
    return { page: 'wantlist', params };
  }
  if (path === '/lend') return { page: 'lend', params };
  if (path === '/stats') return { page: 'stats', params };
  if (path === '/settings') return { page: 'settings', params };
  if (path === '/about') return { page: 'about', params };
  if (path.startsWith('/playlists')) {
    const parts = path.split('/'); // ['', 'playlists', 'smart', key] or ['', 'playlists', id]
    if (parts[2] === 'smart' && parts[3]) return { page: 'playlists', params: { smart: parts[3] } };
    return { page: 'playlists', params: parts[2] ? { id: parts[2] } : {} };
  }
  return { page: 'dashboard', params };
}

export function App() {
  const [route, setRoute] = useState(() => routeFromLocation());

  const navigate = (page, params = {}) => {
    setRoute({ page, params });

    // Update URL based on page
    let url = '/';
    if (page === 'dashboard') {
      url = '/';
    } else if (page === 'add') {
      url = '/add';
    } else if (page === 'edit') {
      url = `/edit/${params.id}`;
    } else if (page === 'detail') {
      url = `/album/${params.id}`;
    } else if (page === 'collections') {
      const queryString = new URLSearchParams(params).toString();
      url = queryString ? `/collections?${queryString}` : '/collections';
    } else if (page === 'wantlist') {
      const queryString = new URLSearchParams(params).toString();
      url = queryString ? `/wantlist?${queryString}` : '/wantlist';
    } else if (page === 'lend') {
      url = '/lend';
    } else if (page === 'stats') {
      url = '/stats';
    } else if (page === 'settings') {
      url = '/settings';
    } else if (page === 'about') {
      url = '/about';
    } else if (page === 'playlists') {
      url = params.smart ? `/playlists/smart/${params.smart}` : params.id ? `/playlists/${params.id}` : '/playlists';
    }
    window.history.pushState({}, '', url);
  };

  // Handle browser back/forward buttons
  useEffect(() => {
    const handlePopState = () => setRoute(routeFromLocation());
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  return (
    <Layout navigate={navigate} currentPage={route.page}>
      {route.page === 'dashboard' && <Dashboard navigate={navigate} />}
      {route.page === 'add' && <AlbumForm navigate={navigate} params={route.params} />}
      {route.page === 'edit' && <AlbumForm navigate={navigate} albumId={route.params.id} />}
      {route.page === 'detail' && <AlbumDetail navigate={navigate} albumId={route.params.id} />}
      {route.page === 'collections' && <Collections navigate={navigate} params={route.params} />}
      {route.page === 'wantlist' && <WantList navigate={navigate} params={route.params} />}
      {route.page === 'lend' && <Lend navigate={navigate} />}
      {route.page === 'stats' && <Stats />}
      {route.page === 'settings' && <Settings navigate={navigate} />}
      {route.page === 'about' && <About />}
      {route.page === 'playlists' && <Playlists navigate={navigate} params={route.params} />}
    </Layout>
  );
}
