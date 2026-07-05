import React, { useState } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { createInvoice } from '../api';

const PRODUCTS = [
  { key: 'premium_1_month',  label: '1 Month',  stars: 500,  badge: null },
  { key: 'premium_2_months', label: '2 Months', stars: 1000, badge: null },
  { key: 'premium_6_months', label: '6 Months', stars: 2500, badge: '🔥 Best Offer' },
];

export default function PremiumGate({ telegramId, onUnlocked, onBack }) {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(false);

  async function handlePurchase(productKey) {
    try {
      setLoading(true);
      const res = await createInvoice(telegramId, productKey);
      const invoiceUrl = res.data.invoice;
      window.Telegram.WebApp.openInvoice(invoiceUrl, (status) => {
        if (status === 'paid') onUnlocked();
      });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-full">

      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-gray-400 text-sm px-1 py-3 self-start"
      >
        ← Back to Free
      </button>

      {/* Gate content */}
      <div className="flex flex-col items-center justify-center gap-6 p-6 text-center flex-1">
        <div className="text-5xl">🔒</div>
        <h2 className="text-xl font-bold text-white">{t('premiumContent')}</h2>
        <p className="text-gray-400 text-sm">{t('lockedMessage')}</p>

        <div className="flex flex-col gap-3 w-full max-w-xs">
          {PRODUCTS.map((p) => (
            <div key={p.key} className="relative">
              {p.badge && (
                <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-red-500 text-white text-xs font-bold px-3 py-0.5 rounded-full z-10">
                  {p.badge}
                </span>
              )}
              <button
                onClick={() => handlePurchase(p.key)}
                disabled={loading}
                className={`w-full font-bold py-3 px-6 rounded-xl transition disabled:opacity-50 ${
                  p.badge
                    ? 'bg-amber-500 hover:bg-amber-400 text-black border-2 border-red-500'
                    : 'bg-amber-500 hover:bg-amber-400 text-black'
                }`}
              >
                {p.label} · {p.stars} ⭐
              </button>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
