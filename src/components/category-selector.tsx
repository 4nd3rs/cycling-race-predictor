"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";

// Re-export utilities for convenience
export { formatCategoryDisplay, getCategoryBadgeVariant } from "@/lib/category-utils";

interface Category {
  key: string;
  ageCategory: string;
  gender: string;
  displayName: string;
  riderCount: number;
}

interface CategorySelectorProps {
  availableCategories: Category[];
  selectedCategories: string[];
  onChange: (selected: string[]) => void;
  disabled?: boolean;
}

export function CategorySelector({
  availableCategories,
  selectedCategories,
  onChange,
  disabled = false,
}: CategorySelectorProps) {
  const handleToggle = (categoryKey: string) => {
    if (selectedCategories.includes(categoryKey)) {
      onChange(selectedCategories.filter((k) => k !== categoryKey));
    } else {
      onChange([...selectedCategories, categoryKey]);
    }
  };

  const selectAll = () => {
    onChange(availableCategories.map((c) => c.key));
  };

  const selectNone = () => {
    onChange([]);
  };

  const totalSelected = selectedCategories.reduce((sum, key) => {
    const cat = availableCategories.find((c) => c.key === key);
    return sum + (cat?.riderCount || 0);
  }, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Select which categories to create races for:
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={selectAll}
            disabled={disabled}
            className="text-xs text-primary hover:underline disabled:opacity-50"
          >
            Select all
          </button>
          <span className="text-muted-foreground">|</span>
          <button
            type="button"
            onClick={selectNone}
            disabled={disabled}
            className="text-xs text-primary hover:underline disabled:opacity-50"
          >
            Select none
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {availableCategories.map((category) => (
          <label
            key={category.key}
            className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
              selectedCategories.includes(category.key)
                ? "bg-primary/5 border-primary"
                : "bg-card hover:bg-muted/50"
            } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <Checkbox
              checked={selectedCategories.includes(category.key)}
              onCheckedChange={() => handleToggle(category.key)}
              disabled={disabled}
            />
            <div className="flex-1">
              <p className="font-medium">{category.displayName}</p>
              <p className="text-xs text-muted-foreground">
                {category.riderCount} riders
              </p>
            </div>
            <Badge variant="outline" className="text-xs">
              {category.ageCategory === "elite"
                ? "Elite"
                : category.ageCategory === "u23"
                ? "U23"
                : "Junior"}
            </Badge>
          </label>
        ))}
      </div>

      {selectedCategories.length > 0 && (
        <div className="text-sm text-muted-foreground">
          {selectedCategories.length} {selectedCategories.length === 1 ? "race" : "races"} will be created with{" "}
          {totalSelected} total riders
        </div>
      )}
    </div>
  );
}

