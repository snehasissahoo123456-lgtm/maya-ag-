/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * @fileoverview 6-Box Auto-Focus OTP Input Component
 * Supports:
 * - 6 individual auto-focus digit boxes
 * - Automatic forward advance on input
 * - Backspace rewind with value clearing
 * - Left/Right arrow navigation
 * - Native multi-character clipboard paste
 * - 1-Click System Clipboard Paste via navigator.clipboard.readText()
 * - 1-Click Demo Code Paste (e.g. 123456)
 * - Auto-submit on 6th digit completion
 * - Cybernetic dark glassmorphism styling
 */

import React, { useRef, useEffect, useState } from 'react';
import { Clipboard, KeyRound, Check, RefreshCw, X, Zap } from 'lucide-react';

export interface OtpInputProps {
  length?: number;
  value: string;
  onChange: (code: string) => void;
  onComplete?: (code: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  demoCode?: string;
  className?: string;
  hasError?: boolean;
}

export const OtpInput: React.FC<OtpInputProps> = ({
  length = 6,
  value = '',
  onChange,
  onComplete,
  disabled = false,
  autoFocus = true,
  demoCode = '123456',
  className = '',
  hasError = false,
}) => {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [pasteNotice, setPasteNotice] = useState<string | null>(null);
  const [isReadingClipboard, setIsReadingClipboard] = useState(false);

  // Split string into array of exact length
  const digits = Array.from({ length }, (_, i) => value[i] || '');

  // Auto-focus first empty box on mount if autoFocus is true
  useEffect(() => {
    if (autoFocus && !disabled) {
      const firstEmptyIndex = digits.findIndex((d) => !d);
      const targetIndex = firstEmptyIndex === -1 ? 0 : firstEmptyIndex;
      inputRefs.current[targetIndex]?.focus();
    }
  }, []);

  // Update value helper
  const updateCode = (newDigits: string[], shouldTriggerComplete = true) => {
    const newCode = newDigits.join('');
    onChange(newCode);

    if (shouldTriggerComplete && newCode.length === length) {
      onComplete?.(newCode);
    }
  };

  // Handle single digit changes
  const handleDigitChange = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const rawVal = e.target.value;
    const cleanNumbers = rawVal.replace(/\D/g, '');

    // If user typed or pasted multiple characters into a single box
    if (cleanNumbers.length > 1) {
      applyPastedString(cleanNumbers, index);
      return;
    }

    const newDigits = [...digits];
    if (cleanNumbers.length === 0) {
      newDigits[index] = '';
      updateCode(newDigits, false);
      return;
    }

    // Insert last typed character
    newDigits[index] = cleanNumbers[cleanNumbers.length - 1];
    updateCode(newDigits, true);

    // Auto-advance focus to next box
    if (index < length - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  // Handle backspace, arrows, and enter
  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (!digits[index] && index > 0) {
        // Current box is empty, jump to previous box, clear it, and focus
        const newDigits = [...digits];
        newDigits[index - 1] = '';
        updateCode(newDigits, false);
        inputRefs.current[index - 1]?.focus();
        e.preventDefault();
      } else if (digits[index]) {
        // Clear current box without jumping back
        const newDigits = [...digits];
        newDigits[index] = '';
        updateCode(newDigits, false);
        e.preventDefault();
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault();
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < length - 1) {
      e.preventDefault();
      inputRefs.current[index + 1]?.focus();
    } else if (e.key === 'Enter') {
      const code = digits.join('');
      if (code.length === length) {
        onComplete?.(code);
      }
    }
  };

  // Apply a multi-character string across boxes
  const applyPastedString = (text: string, startIndex = 0) => {
    const cleaned = text.replace(/\D/g, '');
    if (!cleaned) return;

    const newDigits = [...digits];
    let fillPointer = startIndex;

    // If pasted length is exactly the OTP length, fill from 0
    if (cleaned.length >= length) {
      for (let i = 0; i < length; i++) {
        newDigits[i] = cleaned[i];
      }
      fillPointer = length - 1;
    } else {
      for (let i = 0; i < cleaned.length && fillPointer < length; i++) {
        newDigits[fillPointer] = cleaned[i];
        fillPointer++;
      }
    }

    updateCode(newDigits, true);

    // Focus last filled box or next empty box
    const nextEmptyIndex = newDigits.findIndex((d) => !d);
    if (nextEmptyIndex !== -1) {
      inputRefs.current[nextEmptyIndex]?.focus();
    } else {
      inputRefs.current[length - 1]?.focus();
    }
  };

  // Native onPaste event on any box or container
  const handleNativePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text/plain');
    applyPastedString(pasted, 0);
    showNotice('Code pasted from clipboard!');
  };

  // 1-Click System Clipboard Pasting via navigator.clipboard.readText()
  const handle1ClickSystemClipboardPaste = async () => {
    setIsReadingClipboard(true);
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const clipboardText = await navigator.clipboard.readText();
        const cleaned = clipboardText.replace(/\D/g, '');
        if (cleaned.length > 0) {
          applyPastedString(cleaned, 0);
          showNotice(`Pasted ${cleaned.slice(0, length)} from clipboard!`);
          return;
        }
      }
      // If clipboard was empty or no numbers found, fall back to demoCode
      applyPastedString(demoCode, 0);
      showNotice(`Pasted verified test code (${demoCode})!`);
    } catch (_err) {
      // If browser clipboard permission blocked, fallback to demo code
      applyPastedString(demoCode, 0);
      showNotice(`Pasted verified test code (${demoCode})!`);
    } finally {
      setIsReadingClipboard(false);
    }
  };

  // 1-Click Demo Code Fast Paste
  const handleDemoCodePaste = () => {
    applyPastedString(demoCode, 0);
    showNotice(`Pasted test code (${demoCode})!`);
  };

  // Clear all digits
  const handleClear = () => {
    onChange('');
    inputRefs.current[0]?.focus();
    showNotice('Code cleared');
  };

  const showNotice = (msg: string) => {
    setPasteNotice(msg);
    setTimeout(() => setPasteNotice(null), 2500);
  };

  const isComplete = value.length === length;

  return (
    <div className={`space-y-3.5 ${className}`} onPaste={handleNativePaste}>
      {/* 6 Auto-Focus Input Digit Boxes */}
      <div className="flex items-center justify-center gap-2 sm:gap-3">
        {digits.map((digit, index) => {
          const isFilled = Boolean(digit);
          return (
            <input
              key={index}
              ref={(el) => { inputRefs.current[index] = el; }}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete={index === 0 ? 'one-time-code' : 'off'}
              maxLength={1}
              value={digit}
              disabled={disabled}
              onChange={(e) => handleDigitChange(index, e)}
              onKeyDown={(e) => handleKeyDown(index, e)}
              onFocus={(e) => e.target.select()}
              className={`w-12 h-14 sm:w-14 sm:h-16 text-center text-xl sm:text-2xl font-mono font-bold rounded-2xl border transition-all duration-150 outline-none select-all ${
                hasError
                  ? 'bg-rose-950/40 border-rose-500 text-rose-200 shadow-lg shadow-rose-500/20'
                  : isFilled
                  ? 'bg-indigo-950/50 border-indigo-500 text-white shadow-md shadow-indigo-500/30 scale-[1.03]'
                  : 'bg-slate-950/80 border-slate-800 text-slate-300 hover:border-slate-700 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/30 focus:scale-[1.02]'
              } ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-text'}`}
              aria-label={`Digit ${index + 1} of ${length}`}
            />
          );
        })}
      </div>

      {/* 1-Click Clipboard Actions Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
        <div className="flex items-center gap-2">
          {/* 1-Click Paste from Clipboard Button */}
          <button
            type="button"
            disabled={disabled || isReadingClipboard}
            onClick={handle1ClickSystemClipboardPaste}
            className="px-3 py-1.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-cyan-300 border border-slate-700/80 hover:border-cyan-500/50 font-medium transition-all shadow-sm flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            title="Read and paste 6 digits directly from your clipboard"
          >
            {isReadingClipboard ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Clipboard className="w-3.5 h-3.5 text-cyan-400" />
            )}
            <span>1-Click Paste</span>
          </button>

          {/* Quick Demo Test Code Button */}
          {demoCode && (
            <button
              type="button"
              disabled={disabled}
              onClick={handleDemoCodePaste}
              className="px-2.5 py-1.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 font-mono text-[11px] font-semibold transition-all flex items-center gap-1 cursor-pointer"
              title={`Click to fill test code ${demoCode}`}
            >
              <Zap className="w-3 h-3 text-amber-400" />
              <span>{demoCode}</span>
            </button>
          )}
        </div>

        {/* Clear Button & Digit Counter */}
        <div className="flex items-center gap-2 font-mono text-[11px]">
          {value.length > 0 && (
            <button
              type="button"
              onClick={handleClear}
              className="text-slate-400 hover:text-rose-400 transition-colors flex items-center gap-0.5 cursor-pointer"
              title="Clear all digits"
            >
              <X className="w-3 h-3" />
              <span>Clear</span>
            </button>
          )}

          <span
            className={`px-2 py-0.5 rounded-full border text-[10px] ${
              isComplete
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 font-bold flex items-center gap-1'
                : 'bg-slate-950 text-slate-500 border-slate-800'
            }`}
          >
            {isComplete ? (
              <>
                <Check className="w-2.5 h-2.5" />
                <span>Ready</span>
              </>
            ) : (
              <span>{value.length} / {length}</span>
            )}
          </span>
        </div>
      </div>

      {/* Ephemeral Feedback Toast */}
      {pasteNotice && (
        <div className="text-center text-[11px] font-mono text-cyan-300 animate-fadeIn">
          {pasteNotice}
        </div>
      )}
    </div>
  );
};
