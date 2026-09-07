#include "sample_data.h"

namespace trackora {

OptimizationInput CreateSampleInput() {
  OptimizationInput input;
  input.configuration.maxTimeInSeconds = 10.0;
  input.configuration.numSearchWorkers = 1;
  input.configuration.logSearchProgress = false;
  input.configuration.objectiveWeights.maintenancePriority = 10;
  input.configuration.objectiveWeights.assetAvailability = 6;
  input.configuration.objectiveWeights.windowSuitability = 4;
  input.configuration.objectiveWeights.coordination = 8;
  input.configuration.objectiveWeights.operationalPreference = 3;
  input.configuration.objectiveWeights.trainDisruption = 5;
  input.configuration.objectiveWeights.blockActivation = 2;
  input.configuration.objectiveWeights.resourcePenalty = 2;
  input.configuration.objectiveWeights.downtime = 1;

  input.windows = {
      {"W001", "C01", 1320, 1440, 3, true, 90, 0, 12},
      {"W002", "C01", 60, 180, 2, true, 80, 0, 10},
      {"W003", "C02", 1380, 1500, 2, true, 75, 0, 9},
      {"W004", "C02", 180, 300, 2, false, 95, 0, 8},
      {"W005", "C03", 1320, 1410, 2, true, 70, 0, 7},
      {"W006", "C03", 1440, 1560, 2, true, 85, 0, 11},
  };

  input.trains = {
      {"TR001", "C01", 1450, 1470, 5},
      {"TR002", "C01", 200, 220, 4},
      {"TR003", "C02", 1390, 1410, 5},
      {"TR004", "C02", 220, 240, 3},
      {"TR005", "C03", 1340, 1360, 5},
      {"TR006", "C03", 1490, 1510, 4},
      {"TR007", "C01", 600, 630, 2},
      {"TR008", "C02", 700, 730, 2},
  };

  input.resources = {
      {"R-TRACK-C01", "TrackMachine", 1320, 1560, "C01", 1},
      {"R-SIGNAL-C01", "SignalTeam", 60, 1440, "C01", 1},
      {"R-OHE-C03", "OHETeam", 1320, 1560, "C03", 1},
      {"R-CRANE-C02", "Crane", 1380, 1500, "C02", 1},
      {"R-MOBILE", "MobileTeam", 1320, 1560, "C01", 1},
  };

  input.tasks = {
      {"T001", "ASSET-TRACK-01", "Engineering", "C01", 60, 95, true,
       {"R-TRACK-C01"}, {"W001", "W002"}, 80, 4, 6, 2, 0},
      {"T002", "ASSET-SIGNAL-01", "S&T", "C01", 45, 88, true,
       {"R-SIGNAL-C01"}, {"W001", "W002"}, 75, 10, 7, 1, 0},
      {"T003", "ASSET-OHE-01", "Traction", "C03", 60, 82, false,
       {"R-OHE-C03"}, {"W005", "W006"}, 70, 6, 5, 1, 0},
      {"T004", "ASSET-BRIDGE-02", "Engineering", "C02", 90, 98, true,
       {"R-CRANE-C02"}, {"W003", "W004"}, 90, 2, 4, 5, 0},
      {"T005", "ASSET-SIGNAL-02", "S&T", "C02", 45, 72, false,
       {"R-CRANE-C02"}, {"W003", "W004"}, 60, 8, 4, 1, 0},
      {"T006", "ASSET-TRACK-02", "Engineering", "C03", 30, 65, false,
       {"R-OHE-C03"}, {"W005", "W006"}, 55, 3, 3, 2, 0},
      {"T007", "ASSET-OHE-02", "Traction", "C01", 30, 78, false,
       {"R-MOBILE"}, {"W001", "W002"}, 65, 5, 2, 3, 0},
      {"T008", "ASSET-TRACK-03", "Engineering", "C01", 120, 90, true,
       {"R-TRACK-C01"}, {"W001", "W002"}, 85, 3, 5, 2, 0},
  };

  return input;
}

}  // namespace trackora
