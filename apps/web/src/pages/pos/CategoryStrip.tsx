// Category strip — horizontal scrollable pills for the menu grid filter.
import React from 'react';
import { ChefHat } from 'lucide-react';
import type { Category } from './types';

interface Props {
  categories: Category[];
  activeId: string | null;
  onSelect: (id: string | null) => void;
}

export const CategoryStrip: React.FC<Props> = ({ categories, activeId, onSelect }) => {
  return (
    <div className="pos-cats-pro">
      <button
        type="button"
        className={'pos-cat-pill-pro' + (activeId === null ? ' active' : '')}
        onClick={() => onSelect(null)}
      >
        <ChefHat className="h-4 w-4" /> All menu
      </button>
      {categories.map((c) => (
        <button
          key={c.id}
          type="button"
          className={'pos-cat-pill-pro' + (activeId === c.id ? ' active' : '')}
          onClick={() => onSelect(c.id)}
          style={activeId === c.id ? { background: c.color || '#3b82f6', borderColor: c.color || '#3b82f6' } : {}}
        >
          {c.name}
        </button>
      ))}
    </div>
  );
};