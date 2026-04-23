export default function Logo({ size = 'md', className = '' }) {
  const sizes = {
    sm: { icon: 'text-lg', title: 'text-base', sub: 'text-xs' },
    md: { icon: 'text-2xl', title: 'text-xl',  sub: 'text-xs' },
    lg: { icon: 'text-4xl', title: 'text-3xl', sub: 'text-sm' },
  };
  const s = sizes[size];

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div className="relative">
        <div className={`${s.icon} leading-none`}>🏢</div>
      </div>
      <div>
        <div className={`${s.title} font-bold text-white leading-tight tracking-tight`}>
          Nova Copro
        </div>
        <div className={`${s.sub} text-blue-200 font-medium tracking-widest uppercase`}>
          Espace Copropriétaires
        </div>
      </div>
    </div>
  );
}
