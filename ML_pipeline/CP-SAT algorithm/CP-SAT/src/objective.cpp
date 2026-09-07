#include "optimizer.h"

#include <algorithm>
#include <cstdint>

namespace trackora {
namespace {

using operations_research::sat::BoolVar;
using operations_research::sat::CpModelBuilder;
using operations_research::sat::LinearExpr;

int64_t Score(const int64_t value, const int64_t weight) {
  return value * weight;
}

}  // namespace

LinearExpr BuildObjective(
    CpModelBuilder* model, const OptimizationInput& input,
    const std::vector<ObjectiveCandidate>& candidates,
    const std::vector<BoolVar>& activatedBlocks) {
  const ObjectiveWeights& weights = input.configuration.objectiveWeights;
  LinearExpr objective;

  // Maintenance priority rewards selecting high-priority work.
  // Asset availability rewards tasks that return important assets to service.
  // Window suitability rewards ML-ranked candidate windows.
  // Operational preference carries a caller-provided operational preference.
  // Resource penalty discourages consuming resource-intensive combinations.
  // Downtime penalty discourages leaving unused time inside an activated block.
  for (const ObjectiveCandidate& candidate : candidates) {
    const MaintenanceTask& task = input.tasks[candidate.taskIndex];
    const BlockWindow& window = input.windows[candidate.windowIndex];
    const int64_t unusedMinutes =
        std::max<int64_t>(0, window.endMinute - window.startMinute -
                                 task.durationMinutes);
    const int64_t positiveScore =
        Score(task.priorityScore, weights.maintenancePriority) +
        Score(task.assetAvailabilityBenefit, weights.assetAvailability) +
        Score(window.windowScore, weights.windowSuitability) +
        Score(task.operationalPreference, weights.operationalPreference);
    const int64_t negativeScore =
        Score(window.trainDisruptionPenalty, weights.trainDisruption) +
        Score(task.resourcePenalty, weights.resourcePenalty) +
        Score(task.unnecessaryDowntimePenalty + unusedMinutes,
              weights.downtime);
    objective += (positiveScore - negativeScore) * candidate.variable;
  }

  // Block activation cost is charged only when y[w] activates a block.
  for (int windowIndex = 0;
       windowIndex < static_cast<int>(activatedBlocks.size()); ++windowIndex) {
    objective -=
        Score(input.windows[windowIndex].activationCost,
              weights.blockActivation) *
        activatedBlocks[windowIndex];
  }

  // Coordination rewards compatible tasks from different departments sharing
  // the same corridor and activated block. The AND variable is constrained to
  // one only when both assignment variables are selected.
  for (int first = 0; first < static_cast<int>(candidates.size()); ++first) {
    for (int second = first + 1;
         second < static_cast<int>(candidates.size()); ++second) {
      const ObjectiveCandidate& left = candidates[first];
      const ObjectiveCandidate& right = candidates[second];
      const MaintenanceTask& leftTask = input.tasks[left.taskIndex];
      const MaintenanceTask& rightTask = input.tasks[right.taskIndex];
      if (left.windowIndex != right.windowIndex ||
          leftTask.department.empty() ||
          leftTask.department == rightTask.department ||
          leftTask.corridorId != rightTask.corridorId) {
        continue;
      }
      const BoolVar coordination =
          model->NewBoolVar().WithName("coordination_" +
                                       std::to_string(first) + "_" +
                                       std::to_string(second));
      model->AddLessOrEqual(coordination, left.variable);
      model->AddLessOrEqual(coordination, right.variable);
      model->AddGreaterOrEqual(coordination,
                                left.variable + right.variable - 1);
      const int64_t coordinationScore =
          std::min(leftTask.coordinationScore, rightTask.coordinationScore);
      objective += Score(coordinationScore, weights.coordination) * coordination;
    }
  }

  return objective;
}

}  // namespace trackora
