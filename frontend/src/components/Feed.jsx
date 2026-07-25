import React, { useEffect, useState, useRef } from 'react';
import ReactDOM from 'react-dom';
import PostCard from './PostCard';
import PremiumGate from './PremiumGate';
import { getFreeFeed, getFullFeed, getActiveLink } from '../api';
import { useLanguage } from '../i18n/LanguageContext';
import giftBox from '../assets/adbox.webp';

function extractUrl(text) {
  if (!text) return null;
  const match = text.match(/https?:\/\/[^\s]+/);
  return match ? match[0] : null;
}

// Floating, draggable, dismissible sponsor bubble.
// Never blocks the screen or scroll — user can drag it out of the way,
// tap it to open the link, or dismiss it immediately with the ✕.
function LinkOverlay({ url, onClose }) {
  const BUBBLE_SIZE = 76;
  const MARGIN = 12;

  const [pos, setPos] = React.useState(() => ({
    x: typeof window !== 'undefined' ? window.innerWidth - BUBBLE_SIZE - MARGIN : MARGIN,
    y: typeof window !== 'undefined' ? window.innerHeight - BUBBLE_SIZE - 140 : 140,
  }));
  const dragState = useRef({ dragging: false, startX: 0, startY: 0, origX: 0, origY: 0, moved: false });

  function clamp(x, y) {
    const maxX = window.innerWidth - BUBBLE_SIZE - MARGIN;
    const maxY = window.innerHeight - BUBBLE_SIZE - MARGIN;
    return { x: Math.min(Math.max(x, MARGIN), maxX), y: Math.min(Math.max(y, MARGIN), maxY) };
  }

  function handlePointerDown(e) {
    const point = e.touches ? e.touches[0] : e;
    dragState.current = {
      dragging: true,
      moved: false,
      startX: point.clientX,
      startY: point.clientY,
      origX: pos.x,
      origY: pos.y,
    };
  }

  function handlePointerMove(e) {
    if (!dragState.current.dragging) return;
    const point = e.touches ? e.touches[0] : e;
    const dx = point.clientX - dragState.current.startX;
    const dy = point.clientY - dragState.current.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragState.current.moved = true;
    const next = clamp(dragState.current.origX + dx, dragState.current.origY + dy);
    setPos(next);
  }

  function handlePointerUp() {
    if (!dragState.current.dragging) return;
    dragState.current.dragging = false;
    // Snap to nearest edge, like a chat-head bubble
    setPos(p => {
      const goLeft = p.x + BUBBLE_SIZE / 2 < window.innerWidth / 2;
      return clamp(goLeft ? MARGIN : window.innerWidth - BUBBLE_SIZE - MARGIN, p.y);
    });
  }

  function handleTap() {
    if (dragState.current.moved) return; // was a drag, not a tap
    window.open(url, '_blank');
  }

  // Keep bubble on screen if the viewport resizes (e.g. keyboard/orientation)
  React.useEffect(() => {
    function onResize() { setPos(p => clamp(p.x, p.y)); }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return ReactDOM.createPortal(
    <>
      <style>{`
        @keyframes giftFloat {
          0%, 100% { transform: translateY(0px); }
          50%       { transform: translateY(-6px); }
        }
        @keyframes bubbleIn {
          from { opacity: 0; transform: scale(0.6); }
          to   { opacity: 1; transform: scale(1); }
        }
        .gift-float { animation: giftFloat 2.6s ease-in-out infinite; }
        .bubble-in  { animation: bubbleIn 0.25s ease-out both; }
      `}</style>

      <div
        className="bubble-in"
        onMouseDown={handlePointerDown}
        onMouseMove={handlePointerMove}
        onMouseUp={handlePointerUp}
        onMouseLeave={handlePointerUp}
        onTouchStart={handlePointerDown}
        onTouchMove={handlePointerMove}
        onTouchEnd={handlePointerUp}
        style={{
          position: 'fixed',
          left: pos.x,
          top: pos.y,
          zIndex: 9999,
          width: BUBBLE_SIZE,
          height: BUBBLE_SIZE,
          touchAction: 'none',
          userSelect: 'none',
          cursor: 'grab',
        }}
      >
        {/* Close / skip — always available immediately, no countdown */}
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          aria-label="Dismiss ad"
          style={{
            position: 'absolute', top: -8, right: -8, zIndex: 2,
            width: 22, height: 22, borderRadius: '50%',
            background: '#1f1f1f', border: '1px solid rgba(255,255,255,0.25)',
            color: '#e5e7eb', fontSize: 12, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', lineHeight: 1,
          }}
        >
          ✕
        </button>

        <button
          onClick={handleTap}
          className="gift-float"
          aria-label="Open sponsored link"
          style={{
            width: '100%', height: '100%', borderRadius: 18,
            background: '#151515', border: '1px solid rgba(220,38,38,0.5)',
            boxShadow: '0 4px 18px rgba(0,0,0,0.5), 0 0 20px rgba(220,38,38,0.25)',
            padding: 4, cursor: 'pointer', display: 'flex',
            alignItems: 'center', justifyContent: 'center', position: 'relative',
          }}
        >
          <img
            src={giftBox}
            alt="Sponsored"
            style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 14, pointerEvents: 'none' }}
            draggable={false}
          />
          <span style={{
            position: 'absolute', bottom: -6, left: '50%', transform: 'translateX(-50%)',
            fontSize: 8, fontWeight: 700, letterSpacing: '0.08em', color: '#b45309',
            background: '#0a0a0a', padding: '1px 5px', borderRadius: 6, whiteSpace: 'nowrap',
            border: '1px solid rgba(180,83,9,0.4)',
          }}>
            SPONSORED
          </span>
        </button>
      </div>
    </>,
    document.body
  );
}

const POSTS_PER_PAGE = 5;
const MAX_VISIBLE_PAGES = 10;

// Pagination bar: numbered page buttons (capped at 10 visible, sliding as you
// page through) + a next-page chevron. Matches the "1 / 2 / >" style —
// active page is filled dark, others outlined.
function Pagination({ currentPage, totalPages, onPageChange }) {
  if (totalPages <= 1) return null;

  // Slide a window of up to MAX_VISIBLE_PAGES page numbers, keeping the
  // current page inside it, without ever spilling past totalPages.
  let windowStart = Math.max(1, currentPage - Math.floor(MAX_VISIBLE_PAGES / 2));
  let windowEnd = Math.min(totalPages, windowStart + MAX_VISIBLE_PAGES - 1);
  windowStart = Math.max(1, windowEnd - MAX_VISIBLE_PAGES + 1);

  const pages = [];
  for (let i = windowStart; i <= windowEnd; i++) pages.push(i);

  return (
    <div className="flex items-center justify-center gap-2 py-4 flex-wrap">
      {pages.map(page => (
        <button
          key={page}
          onClick={() => onPageChange(page)}
          className={`w-10 h-10 rounded-md flex items-center justify-center text-sm font-semibold transition ${
            page === currentPage
              ? 'bg-gray-700 text-white'
              : 'bg-transparent text-gray-300 border border-gray-600'
          }`}
        >
          {page}
        </button>
      ))}
      <button
        onClick={() => onPageChange(Math.min(currentPage + 1, totalPages))}
        disabled={currentPage === totalPages}
        aria-label="Next page"
        className="w-10 h-10 flex items-center justify-center text-gray-300 disabled:text-gray-700 disabled:cursor-not-allowed"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
    </div>
  );
}

export default function Feed({ isPremium, telegramId, onUnlocked, isAdmin, adminSecret, navigateToPostId, onNavigated }) {
  const { t } = useLanguage();
  const [freePosts,    setFreePosts]    = useState([]);
  const [premiumPosts, setPremiumPosts] = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [showGate,     setShowGate]     = useState(false);
  const [activeTab,    setActiveTab]    = useState('free');
  const [overlayUrl,   setOverlayUrl]   = useState(null);
  const [currentPage,  setCurrentPage]  = useState(1);
  const postRefs = useRef({});
  const scrollRef = useRef(null);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const freeRes = await getFreeFeed(telegramId);
        setFreePosts((freeRes.data.posts || []).filter(p => p.tier === 'free'));
        if (isPremium || isAdmin) {
          const fullRes = await getFullFeed(telegramId);
          setPremiumPosts((fullRes.data.posts || []).filter(p => p.tier === 'premium'));
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [isPremium, isAdmin]);

  useEffect(() => {
    if (!navigateToPostId) return;
    const allPosts = [...freePosts, ...premiumPosts];
    const target = allPosts.find(p => p.id === navigateToPostId);
    if (target) {
      const tierPosts = target.tier === 'premium' ? premiumPosts : freePosts;
      const idx = tierPosts.findIndex(p => p.id === navigateToPostId);
      setActiveTab(target.tier === 'premium' ? 'premium' : 'free');
      setCurrentPage(Math.floor(idx / POSTS_PER_PAGE) + 1);
    }
    setTimeout(() => {
      const el = postRefs.current[navigateToPostId];
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.outline = '2px solid #f59e0b';
        setTimeout(() => { el.style.outline = ''; }, 1500);
      }
      onNavigated?.();
    }, 100);
  }, [navigateToPostId]);

  useEffect(() => {
    async function fetchLink() {
      try {
        const res = await getActiveLink();
        if (res.data.link?.url) setOverlayUrl(res.data.link.url);
      } catch (err) {
        console.error('Failed to fetch active link', err);
      }
    }
    fetchLink();
  }, []);

  function handleDeleted(postId) {
    setFreePosts(prev => prev.filter(p => p.id !== postId));
    setPremiumPosts(prev => prev.filter(p => p.id !== postId));
  }

  // Reset to page 1 whenever the visible tab changes
  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab]);

  function handlePageChange(page) {
    setCurrentPage(page);
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (showGate) {
    return (
      <PremiumGate
        telegramId={telegramId}
        onUnlocked={() => { setShowGate(false); setActiveTab('free'); onUnlocked(); }}
        onBack={() => { setShowGate(false); setActiveTab('free'); }}
      />
    );
  }

  const displayed = activeTab === 'free' ? freePosts : premiumPosts;
  const totalPages = Math.max(1, Math.ceil(displayed.length / POSTS_PER_PAGE));
  const pageStart = (currentPage - 1) * POSTS_PER_PAGE;
  const pagePosts = displayed.slice(pageStart, pageStart + POSTS_PER_PAGE);

  return (
    <div className="flex flex-col h-full">
      {overlayUrl && <LinkOverlay url={overlayUrl} onClose={() => setOverlayUrl(null)} />}

      <div className="flex border-b border-border mb-4">
        <button
          onClick={() => setActiveTab('free')}
          className={`flex-1 py-3 text-sm font-semibold transition ${activeTab === 'free' ? 'text-white border-b-2 border-white' : 'text-gray-500'}`}
        >
          {t('free')}
        </button>
        <button
          onClick={() => isPremium || isAdmin ? setActiveTab('premium') : setShowGate(true)}
          className={`flex-1 py-3 text-sm font-semibold transition ${activeTab === 'premium' ? 'text-amber-400 border-b-2 border-amber-400' : 'text-gray-500'}`}
        >
          {t('premium')} ⭐
        </button>
      </div>

      {loading ? (
        <p className="text-center text-gray-500 mt-10">{t('loading')}</p>
      ) : displayed.length === 0 ? (
        <p className="text-center text-gray-500 mt-10">{t('noPosts')}</p>
      ) : (
        <div ref={scrollRef} className="overflow-y-auto pb-20">
          {pagePosts.map(post => (
            <PostCard
              key={post.id}
              post={post}
              isPremium={isPremium || isAdmin}
              userId={telegramId}
              onLockTap={() => setShowGate(true)}
              isAdmin={isAdmin}
              adminSecret={adminSecret}
              onDeleted={handleDeleted}
              postRef={el => { if (el) postRefs.current[post.id] = el; }}
              adUrl={overlayUrl}
            />
          ))}
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={handlePageChange}
          />
        </div>
      )}
    </div>
  );
}
