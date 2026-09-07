#pragma once

#include "models.h"

#include <ortools/sat/cp_model.h>

#include <vector>

namespace trackora {

struct ObjectiveCandidate {
  int taskIndex;
  int windowIndex;
  operations_research::sat::BoolVar variable;
};

operations_research::sat::LinearExpr BuildObjective(
    operations_research::sat::CpModelBuilder* model,
    const OptimizationInput& input,
    const std::vector<ObjectiveCandidate>& candidates,
    const std::vector<operations_research::sat::BoolVar>& activatedBlocks);

class TrackoraOptimizer {
 public:
  OptimizationResult optimize(const OptimizationInput& input) const;
};

}  // namespace trackora
