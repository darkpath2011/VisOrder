/**
 * HeroGrid.tsx draws a non-interactive 5×5 Schulte plane as the landing hero product visual.
 * Numbers stay fixed so the board reads as product imagery; cell “1” carries a quiet pulse
 * that hints at ordered search without turning the hero into a live trainer.
 */

const HERO_CELLS = [
  16, 3, 21, 8, 12, 7, 24, 1, 19, 14, 22, 9, 5, 17, 11, 2, 15, 25, 6, 20, 13, 18,
  10, 4, 23,
];

/**
 * HeroGrid renders a complete, unclipped 5×5 board as the hero’s dominant visual plane.
 * Motion lives mostly on the board container; only the starting cell adds a second pulse.
 */
export function HeroGrid() {
  return (
    <div className="hero-grid" aria-hidden="true">
      {HERO_CELLS.map((value, index) => (
        <span
          key={`${value}-${index}`}
          className={
            value === 1 ? "hero-grid__cell hero-grid__cell--focus" : "hero-grid__cell"
          }
        >
          {value}
        </span>
      ))}
    </div>
  );
}
