#pragma once

#include <cstdint>

namespace trackora {

struct ObjectiveWeights {
  int64_t maintenancePriority = 1;
  int64_t assetAvailability = 1;
  int64_t windowSuitability = 1;
  int64_t coordination = 1;
  int64_t operationalPreference = 1;
  int64_t trainDisruption = 1;
  int64_t blockActivation = 1;
  int64_t resourcePenalty = 1;
  int64_t downtime = 1;
};

// Solver settings are kept independent of the CP-SAT implementation so the
// input model can be supplied by another service without solver coupling.
struct SolverConfig {
  double maxTimeInSeconds = 30.0;
  int32_t numSearchWorkers = 1;
  bool logSearchProgress = false;
  ObjectiveWeights objectiveWeights;
};

}  // namespace trackora
