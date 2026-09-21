import { ArrowUpRight, MessageSquare, Sparkles, UserRound } from 'lucide-react';

/** Local artwork with a reserved frame to keep app cards stable while loading. */
export default function ProductArtwork({ product }: { product: string }) {
  if (product === 'wed') {
    return (
      <div className="product-artwork wed-artwork" aria-hidden="true">
        <img src="/wed-640.webp" srcSet="/wed-640.webp 640w, /wed-1100.webp 1100w" sizes="(max-width: 599px) calc(100vw - 40px), (max-width: 899px) 35vw, (max-width: 1100px) 30vw, 480px" width={1100} height={912} alt="" decoding="async" />
      </div>
    );
  }

  return (
    <div className="product-artwork assist-artwork" aria-hidden="true">
      <span className="artwork-index">A / 02</span>
      <svg className="assist-connections" viewBox="0 0 400 240" preserveAspectRatio="none" fill="none">
        <path d="M70 150H160V80H315M200 80V178H285" stroke="currentColor" strokeWidth="1" />
        <circle cx="160" cy="80" r="3" fill="currentColor" />
        <circle cx="200" cy="178" r="3" fill="currentColor" />
      </svg>
      <span className="assist-node node-message"><MessageSquare size={24} strokeWidth={1.2} /></span>
      <span className="assist-node node-spark"><Sparkles size={32} strokeWidth={1.2} /></span>
      <span className="assist-node node-user"><UserRound size={23} strokeWidth={1.2} /></span>
      <span className="assist-node node-arrow"><ArrowUpRight size={24} strokeWidth={1.2} /></span>
      <span className="artwork-caption">A LITTLE LESS WORK. A LOT MORE CONNECTION.</span>
    </div>
  );
}
