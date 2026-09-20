import { ArrowUpRight, MessageSquare, Sparkles, UserRound } from 'lucide-react';

/** Small, local vector compositions: no image requests or layout shifts. */
export default function ProductArtwork({ product }: { product: string }) {
  if (product === 'wed') {
    return (
      <div className="product-artwork wed-artwork" aria-hidden="true">
        <span className="artwork-index">W / 01</span>
        <div className="wed-rings"><span /><span /></div>
        <div className="wed-invitation">
          <span className="invitation-kicker">A NEW CHAPTER</span>
          <span className="invitation-title">Together<br /><em>starts here.</em></span>
          <span className="invitation-rule" />
          <span className="invitation-footer">A DAY TO REMEMBER. A PLACE TO SHARE.</span>
        </div>
        <span className="artwork-caption">DESIGNED FOR YOUR FOREVER</span>
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
