import { useRef } from 'react';

export default function OTPInput({ value, onChange, disabled }) {
  const inputs = useRef([]);

  const handleChange = (index, e) => {
    const val = e.target.value.replace(/\D/g, '');
    if (!val) return;

    const char = val[val.length - 1];
    const newValue = value.split('');
    newValue[index] = char;
    const next = newValue.join('');
    onChange(next);

    // Focus suivant
    if (index < 5 && char) {
      inputs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace') {
      const newValue = value.split('');
      if (newValue[index]) {
        newValue[index] = '';
        onChange(newValue.join(''));
      } else if (index > 0) {
        newValue[index - 1] = '';
        onChange(newValue.join(''));
        inputs.current[index - 1]?.focus();
      }
    }
    if (e.key === 'ArrowLeft' && index > 0) {
      inputs.current[index - 1]?.focus();
    }
    if (e.key === 'ArrowRight' && index < 5) {
      inputs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    onChange(pasted.padEnd(6, '').slice(0, 6));
    // Focus dernier champ rempli
    const lastIndex = Math.min(pasted.length, 5);
    inputs.current[lastIndex]?.focus();
  };

  return (
    <div className="flex gap-2 justify-center">
      {Array.from({ length: 6 }).map((_, i) => (
        <input
          key={i}
          ref={(el) => (inputs.current[i] = el)}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={value[i] || ''}
          onChange={(e) => handleChange(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          disabled={disabled}
          className={`
            w-11 h-14 text-center text-2xl font-bold rounded-xl border-2 
            transition-all duration-200 bg-white outline-none
            ${value[i]
              ? 'border-brand-500 text-brand-700 bg-blue-50'
              : 'border-gray-200 text-gray-900'
            }
            focus:border-brand-500 focus:ring-2 focus:ring-brand-200
            disabled:opacity-50 disabled:cursor-not-allowed
          `}
        />
      ))}
    </div>
  );
}
