import { useEffect, useState } from 'react';
export const MOBILE_LAYOUT = '(max-width: 760px), (max-height: 520px) and (pointer: coarse)';
export default function useMobileLayout() {
  const [mobile, setMobile] = useState(() => window.matchMedia(MOBILE_LAYOUT).matches);
  useEffect(() => {
    const media = window.matchMedia(MOBILE_LAYOUT);
    const change = () => setMobile(media.matches);
    media.addEventListener('change', change); change();
    return () => media.removeEventListener('change', change);
  }, []);
  return mobile;
}
