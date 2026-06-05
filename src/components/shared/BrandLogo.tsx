interface BrandLogoProps { size?: number; }

export function BrandLogo({ size = 36 }: BrandLogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="40" height="40" rx="10" fill="#111827"/>
      <circle cx="20" cy="17" r="7.5" fill="none" stroke="#FFFFFF" strokeWidth="2.2"/>
      <circle cx="20" cy="17" r="3.2" fill="#EF4444"/>
      <path d="M14.5 23L20 30L25.5 23Z" fill="#E5E7EB"/>
    </svg>
  );
}
