export type CfbTeamProfile = {
  team: string;
  games: number;

  offense: {
    pointsPerGame: number;
    yardsPerGame: number;
    passingYardsPerGame: number;
    rushingYardsPerGame: number;
    turnoversPerGame: number;
  };

  defense: {
    pointsAllowedPerGame: number;
    yardsAllowedPerGame: number;
    passingYardsAllowedPerGame: number;
    rushingYardsAllowedPerGame: number;
    takeawaysPerGame: number;
  };
};

export type CfbGame = {
  event_id: string;
  start_date: string;
  away_team: string;
  home_team: string;

  moneyline?: Array<{
    team: string;
    odds: string;
  }>;

  spread?: Array<{
    team: string;
    line: number;
    odds: string;
  }>;

  total?: Array<{
    side: string;
    line: number;
    odds: string;
  }>;
};

export type CfbAnalysis = {
  raw_rating_difference: number;
  projected_home_margin: number;
  projected_winner: string;
  projected_margin: number;
  home_field_adjustment: number;

  market_analysis: {
    model_favorite: string;
    market_favorite: string | null;
    model_projected_home_margin: number;
    market_implied_home_margin: number | null;
    model_vs_market_difference: number | null;
    spread_lean: string | null;
  };
};

const HOME_FIELD_ADVANTAGE = 2.5;

function average(
  values: number[]
): number {
  if (values.length === 0) return 0;

  return (
    values.reduce(
      (sum, value) => sum + value,
      0
    ) / values.length
  );
}

/*
  Creates a simple normalized team strength
  from offense and defense.

  This is intentionally separate from NFL.
  We can calibrate it later using historical
  college football results.
*/

export function calculateTeamRating(
  profile: CfbTeamProfile
): number {
  const offensiveStrength =
    profile.offense.pointsPerGame * 0.45 +
    profile.offense.yardsPerGame * 0.015 +
    profile.offense.rushingYardsPerGame * 0.01 -
    profile.offense.turnoversPerGame * 2;

  const defensiveStrength =
    -profile.defense.pointsAllowedPerGame * 0.45 -
    profile.defense.yardsAllowedPerGame * 0.012 -
    profile.defense.rushingYardsAllowedPerGame * 0.008 +
    profile.defense.takeawaysPerGame * 2;

  return (
    offensiveStrength +
    defensiveStrength
  );
}

export function analyzeCfbGame(
  game: CfbGame,
  awayProfile: CfbTeamProfile,
  homeProfile: CfbTeamProfile
): CfbAnalysis {
  const awayRating =
    calculateTeamRating(
      awayProfile
    );

  const homeRating =
    calculateTeamRating(
      homeProfile
    );

  /*
    Positive = home team advantage.
  */

  const rawDifference =
    homeRating - awayRating;

  const projectedHomeMargin =
    rawDifference +
    HOME_FIELD_ADVANTAGE;

  const projectedWinner =
    projectedHomeMargin >= 0
      ? game.home_team
      : game.away_team;

  const projectedMargin =
    Math.abs(projectedHomeMargin);

  const marketSpread =
    game.spread?.find(
      (spread) =>
        spread.team ===
        game.home_team
    );

  const marketAwaySpread =
    game.spread?.find(
      (spread) =>
        spread.team ===
        game.away_team
    );

  let marketImpliedHomeMargin:
    number | null = null;

  let marketFavorite:
    string | null = null;

  if (marketSpread) {
    marketImpliedHomeMargin =
      -marketSpread.line;

    if (marketSpread.line < 0) {
      marketFavorite =
        game.home_team;
    }
  }

  if (marketAwaySpread) {
    if (marketImpliedHomeMargin === null) {
      marketImpliedHomeMargin =
        marketAwaySpread.line;
    }

    if (marketAwaySpread.line < 0) {
      marketFavorite =
        game.away_team;
    }
  }

  const modelFavorite =
    projectedHomeMargin >= 0
      ? game.home_team
      : game.away_team;

  let spreadLean:
    string | null = null;

  if (
    marketImpliedHomeMargin !== null
  ) {
    if (
      projectedHomeMargin >
      marketImpliedHomeMargin
    ) {
      spreadLean =
        game.home_team;
    } else {
      spreadLean =
        game.away_team;
    }
  }

  const modelMarketDifference =
    marketImpliedHomeMargin === null
      ? null
      : Number(
          (
            projectedHomeMargin -
            marketImpliedHomeMargin
          ).toFixed(2)
        );

  return {
    raw_rating_difference:
      Number(
        rawDifference.toFixed(2)
      ),

    projected_home_margin:
      Number(
        projectedHomeMargin.toFixed(2)
      ),

    projected_winner:
      projectedWinner,

    projected_margin:
      Number(
        projectedMargin.toFixed(2)
      ),

    home_field_adjustment:
      HOME_FIELD_ADVANTAGE,

    market_analysis: {
      model_favorite:
        modelFavorite,

      market_favorite:
        marketFavorite,

      model_projected_home_margin:
        Number(
          projectedHomeMargin.toFixed(2)
        ),

      market_implied_home_margin:
        marketImpliedHomeMargin,

      model_vs_market_difference:
        modelMarketDifference,

      spread_lean:
        spreadLean,
    },
  };
}

/*
  Utility used later by the API route
  to rank CFB games by model/market
  separation.
*/

export function rankCfbGames(
  games: Array<{
    game: CfbGame;
    analysis: CfbAnalysis;
  }>
) {
  return [...games].sort(
    (a, b) => {
      const aEdge =
        Math.abs(
          a.analysis.market_analysis
            .model_vs_market_difference ??
            0
        );

      const bEdge =
        Math.abs(
          b.analysis.market_analysis
            .model_vs_market_difference ??
            0
        );

      return bEdge - aEdge;
    }
  );
}
