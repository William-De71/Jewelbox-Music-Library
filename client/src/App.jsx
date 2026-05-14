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

export function App() {
  const [route, setRoute] = useState({ page: 'dashboard', params: {} });

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
    }
    window.history.pushState({}, '', url);
  };

  // Handle browser back/forward buttons
  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname;
      const urlParams = new URLSearchParams(window.location.search);
      const params = {};

      if (path === '/') {
        setRoute({ page: 'dashboard', params });
      } else if (path === '/add') {
        urlParams.forEach((value, key) => params[key] = value);
        setRoute({ page: 'add', params });
      } else if (path.startsWith('/edit/')) {
        const id = path.split('/')[2];
        setRoute({ page: 'edit', params: { id } });
      } else if (path.startsWith('/album/')) {
        const id = path.split('/')[2];
        setRoute({ page: 'detail', params: { id } });
      } else if (path === '/collections') {
        urlParams.forEach((value, key) => params[key] = value);
        setRoute({ page: 'collections', params });
      } else if (path === '/wantlist') {
        urlParams.forEach((value, key) => params[key] = value);
        setRoute({ page: 'wantlist', params });
      } else if (path === '/lend') {
        setRoute({ page: 'lend', params });
      } else if (path === '/stats') {
        setRoute({ page: 'stats', params });
      } else if (path === '/settings') {
        setRoute({ page: 'settings', params });
      } else if (path === '/about') {
        setRoute({ page: 'about', params });
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Set initial URL
  useEffect(() => {
    const path = window.location.pathname;
    if (path !== '/') {
      window.history.replaceState({}, '', '/');
    }
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
    </Layout>
  );
}
