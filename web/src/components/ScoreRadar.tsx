import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Legend,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';

interface ScoreData {
  recency: number;
  engagement: number;
  bridging: number;
  sourceDiversity: number;
  relevance: number;
}

interface ScoreRadarProps {
  /** Post's actual scores (0-1 scale) */
  scores?: ScoreData;
  /** Current governance weights (0-1 scale, optional overlay) */
  weights?: ScoreData;
  /** Show weights as a second radar */
  showWeights?: boolean;
  /** Chart height in pixels */
  height?: number;
}

const SCORE_LABELS: Record<keyof ScoreData, string> = {
  recency: 'Recency',
  engagement: 'Engagement',
  bridging: 'Bridging',
  sourceDiversity: 'Source diversity',
  relevance: 'Relevance',
};

/**
 * ScoreRadar Component
 *
 * Radar chart visualization of the 5 scoring components.
 * Can show post scores alone or overlaid with governance weights.
 */
export function ScoreRadar({
  scores,
  weights,
  showWeights = false,
  height = 300,
}: ScoreRadarProps) {
  // Transform data for recharts
  const data = Object.keys(SCORE_LABELS).map((key) => ({
    component: SCORE_LABELS[key as keyof ScoreData],
    score: scores ? (scores[key as keyof ScoreData] * 100) : 0,
    weight: weights ? (weights[key as keyof ScoreData] * 100) : 0,
  }));

  // Bluesky design tokens
  const colors = {
    blue: '#1083fe',
    blueLight: 'rgba(16, 131, 254, 0.15)',
    grid: '#2e3033',
    text: '#828689',
    textLight: '#6b6e70',
    tooltipBg: '#1e1f21',
    tooltipBorder: '#2e3033',
  };

  return (
    <div className="score-radar">
      <ResponsiveContainer width="100%" height={height}>
        <RadarChart data={data} margin={{ top: 20, right: 30, bottom: 20, left: 30 }}>
          <PolarGrid stroke={colors.grid} />
          <PolarAngleAxis
            dataKey="component"
            tick={{ fill: colors.text, fontSize: 12 }}
            tickLine={false}
          />
          <PolarRadiusAxis
            angle={90}
            domain={[0, 100]}
            tick={{ fill: colors.textLight, fontSize: 10 }}
            tickCount={5}
            axisLine={false}
          />
          {scores && (
            <Radar
              name="Score"
              dataKey="score"
              stroke={colors.blue}
              fill={colors.blue}
              fillOpacity={0.25}
              strokeWidth={2}
            />
          )}
          {showWeights && weights && (
            <Radar
              name="Weight"
              dataKey="weight"
              stroke={colors.blue}
              fill={colors.blue}
              fillOpacity={0.15}
              strokeWidth={2}
              strokeDasharray="4 4"
            />
          )}
          <Tooltip
            formatter={(value) => `${Number(value).toFixed(0)}%`}
            contentStyle={{
              backgroundColor: colors.tooltipBg,
              border: `1px solid ${colors.tooltipBorder}`,
              borderRadius: '8px',
              boxShadow: '0 4px 16px rgba(0, 0, 0, 0.5)',
              color: '#f1f3f5',
              fontSize: '13px',
            }}
            labelStyle={{
              color: '#f1f3f5',
              fontWeight: 600,
              marginBottom: '4px',
            }}
            itemStyle={{
              color: '#f1f3f5',
            }}
          />
          {(scores && showWeights && weights) && (
            <Legend
              wrapperStyle={{
                paddingTop: '12px',
              }}
              formatter={(value) => (
                <span style={{ color: colors.text, fontSize: '12px' }}>{value}</span>
              )}
            />
          )}
        </RadarChart>
      </ResponsiveContainer>

      <style>{`
        .score-radar {
          width: 100%;
        }

        .recharts-legend-item-text {
          color: var(--text-secondary) !important;
        }
      `}</style>
    </div>
  );
}

export default ScoreRadar;
