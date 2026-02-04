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
  sourceDiversity: 'Source Diversity',
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

  return (
    <div className="score-radar">
      <ResponsiveContainer width="100%" height={height}>
        <RadarChart data={data} margin={{ top: 20, right: 30, bottom: 20, left: 30 }}>
          <PolarGrid stroke="#e5e7eb" />
          <PolarAngleAxis
            dataKey="component"
            tick={{ fill: '#666', fontSize: 12 }}
            tickLine={false}
          />
          <PolarRadiusAxis
            angle={90}
            domain={[0, 100]}
            tick={{ fill: '#999', fontSize: 10 }}
            tickCount={5}
          />
          {scores && (
            <Radar
              name="Score"
              dataKey="score"
              stroke="#667eea"
              fill="#667eea"
              fillOpacity={0.5}
              strokeWidth={2}
            />
          )}
          {showWeights && weights && (
            <Radar
              name="Weight"
              dataKey="weight"
              stroke="#764ba2"
              fill="#764ba2"
              fillOpacity={0.2}
              strokeWidth={2}
              strokeDasharray="5 5"
            />
          )}
          <Tooltip
            formatter={(value) => `${Number(value).toFixed(1)}%`}
            contentStyle={{
              backgroundColor: 'rgba(255, 255, 255, 0.95)',
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
            }}
          />
          {(scores && showWeights && weights) && <Legend />}
        </RadarChart>
      </ResponsiveContainer>

      <style>{`
        .score-radar {
          width: 100%;
        }
      `}</style>
    </div>
  );
}

export default ScoreRadar;
