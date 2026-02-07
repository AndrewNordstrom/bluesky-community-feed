/**
 * KeywordInput Component
 *
 * A tag input for entering keywords. Features:
 * - Add keywords by pressing Enter
 * - Remove keywords with X button or Backspace
 * - Visual pills (green for include, red for exclude)
 * - Count display (N/20)
 * - Disabled state during submission
 */

import { useState, useCallback } from 'react';
import type { KeyboardEvent, ChangeEvent } from 'react';
import './KeywordInput.css';

interface KeywordInputProps {
  /** Label for the input */
  label: string;
  /** Description text below the label */
  description: string;
  /** Current keywords */
  keywords: string[];
  /** Callback when keywords change */
  onChange: (keywords: string[]) => void;
  /** Whether the input is disabled */
  disabled?: boolean;
  /** Maximum number of keywords allowed */
  maxKeywords?: number;
  /** Placeholder text */
  placeholder?: string;
  /** Visual variant: 'include' (green) or 'exclude' (red) */
  variant?: 'include' | 'exclude';
}

export function KeywordInput({
  label,
  description,
  keywords,
  onChange,
  disabled = false,
  maxKeywords = 20,
  placeholder = 'Type a keyword and press Enter',
  variant = 'include',
}: KeywordInputProps) {
  const [inputValue, setInputValue] = useState('');

  const addKeyword = useCallback(() => {
    const keyword = inputValue.toLowerCase().trim();
    if (
      keyword &&
      keyword.length <= 50 &&
      !keywords.includes(keyword) &&
      keywords.length < maxKeywords
    ) {
      onChange([...keywords, keyword]);
      setInputValue('');
    }
  }, [inputValue, keywords, maxKeywords, onChange]);

  const removeKeyword = useCallback(
    (keywordToRemove: string) => {
      onChange(keywords.filter((k) => k !== keywordToRemove));
    },
    [keywords, onChange]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addKeyword();
      } else if (e.key === 'Backspace' && !inputValue && keywords.length > 0) {
        removeKeyword(keywords[keywords.length - 1]);
      }
    },
    [addKeyword, inputValue, keywords, removeKeyword]
  );

  const handleInputChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  }, []);

  return (
    <div className={`keyword-input keyword-input--${variant}`}>
      <div className="keyword-input__header">
        <label className="keyword-input__label">{label}</label>
        <span className="keyword-input__count">
          {keywords.length}/{maxKeywords}
        </span>
      </div>
      <p className="keyword-input__description">{description}</p>

      <div className="keyword-input__field">
        <div className="keyword-input__tags">
          {keywords.map((keyword) => (
            <span
              key={keyword}
              className={`keyword-input__tag keyword-input__tag--${variant}`}
            >
              {keyword}
              <button
                type="button"
                onClick={() => removeKeyword(keyword)}
                disabled={disabled}
                className="keyword-input__remove"
                aria-label={`Remove ${keyword}`}
              >
                &times;
              </button>
            </span>
          ))}
          <input
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            disabled={disabled || keywords.length >= maxKeywords}
            placeholder={
              keywords.length >= maxKeywords ? 'Max keywords reached' : placeholder
            }
            className="keyword-input__text-input"
          />
        </div>
      </div>
    </div>
  );
}
