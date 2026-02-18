-- Fix ELO: Recalculate currentElo as conservative estimate (mean - 3*variance)
-- This ensures unknown/uncertain riders show low ELO instead of appearing as top riders.

UPDATE rider_discipline_stats
SET current_elo = GREATEST(0, ROUND(
  CAST(elo_mean AS NUMERIC) - 3 * CAST(elo_variance AS NUMERIC), 2
));

-- Clear cached predictions for non-completed races so they regenerate with correct ELO
DELETE FROM predictions WHERE race_id IN (
  SELECT id FROM races WHERE status != 'completed'
);
