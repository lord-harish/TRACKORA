#include "optimizer.h"

#include <ortools/sat/cp_model.h>

#include <chrono>
#include <cstdint>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

namespace trackora {
namespace {

using operations_research::sat::BoolVar;
using operations_research::sat::CpModelBuilder;
using operations_research::sat::CpSolverResponse;
using operations_research::sat::CpSolverStatus;
using operations_research::sat::LinearExpr;

void AddDiagnostic(OptimizationResult* result, const std::string& message) {
  result->diagnosticMessages.push_back(message);
}

std::string CandidateLabel(const MaintenanceTask& task,
                           const BlockWindow& window) {
  return "[" + task.taskId + "][" + window.windowId + "] ";
}

bool Overlaps(int32_t firstStart, int32_t firstEnd, int32_t secondStart,
              int32_t secondEnd) {
  return firstStart < secondEnd && secondStart < firstEnd;
}

bool ValidateInput(const OptimizationInput& input, OptimizationResult* result) {
  std::unordered_set<std::string> taskIds;
  std::unordered_set<std::string> windowIds;
  std::unordered_set<std::string> resourceIds;

  for (const MaintenanceTask& task : input.tasks) {
    if (task.taskId.empty() || !taskIds.insert(task.taskId).second) {
      AddDiagnostic(result, "Invalid input: task IDs must be non-empty and unique");
      return false;
    }
    if (task.durationMinutes <= 0 || task.corridorId.empty()) {
      AddDiagnostic(result, "Invalid input: task duration and corridor are required");
      return false;
    }
  }
  for (const BlockWindow& window : input.windows) {
    if (window.windowId.empty() || !windowIds.insert(window.windowId).second) {
      AddDiagnostic(result,
                    "Invalid input: window IDs must be non-empty and unique");
      return false;
    }
    if (window.startMinute >= window.endMinute || window.capacity <= 0 ||
        window.corridorId.empty()) {
      AddDiagnostic(result, "Invalid input: window interval, capacity, and corridor "
                           "must be valid");
      return false;
    }
  }
  for (const Resource& resource : input.resources) {
    if (resource.resourceId.empty() ||
        !resourceIds.insert(resource.resourceId).second) {
      AddDiagnostic(result,
                    "Invalid input: resource IDs must be non-empty and unique");
      return false;
    }
    if (resource.availableFrom >= resource.availableTo || resource.capacity <= 0 ||
        resource.corridorId.empty()) {
      AddDiagnostic(result, "Invalid input: resource availability and capacity "
                           "must be valid");
      return false;
    }
  }
  for (const TrainMovement& train : input.trains) {
    if (train.trainId.empty() || train.startMinute >= train.endMinute ||
        train.corridorId.empty()) {
      AddDiagnostic(result, "Invalid input: train ID, interval, and corridor "
                           "must be valid");
      return false;
    }
  }

  for (const MaintenanceTask& task : input.tasks) {
    for (const std::string& windowId : task.candidateWindowIds) {
      if (!windowIds.count(windowId)) {
        AddDiagnostic(result, "Invalid input: task " + task.taskId +
                             " references unknown window " + windowId);
        return false;
      }
    }
    for (const std::string& resourceId : task.requiredResourceIds) {
      if (!resourceIds.count(resourceId)) {
        AddDiagnostic(result, "Invalid input: task " + task.taskId +
                             " references unknown resource " + resourceId);
        return false;
      }
    }
  }
  if (input.configuration.maxTimeInSeconds < 0 ||
      input.configuration.numSearchWorkers <= 0) {
    AddDiagnostic(result, "Invalid input: solver configuration is invalid");
    return false;
  }
  const ObjectiveWeights& weights = input.configuration.objectiveWeights;
  if (weights.maintenancePriority < 0 || weights.assetAvailability < 0 ||
      weights.windowSuitability < 0 || weights.coordination < 0 ||
      weights.operationalPreference < 0 || weights.trainDisruption < 0 ||
      weights.blockActivation < 0 || weights.resourcePenalty < 0 ||
      weights.downtime < 0) {
    AddDiagnostic(result, "Invalid input: objective weights must be non-negative");
    return false;
  }
  return true;
}

SolverStatus ConvertStatus(CpSolverStatus status) {
  switch (status) {
    case CpSolverStatus::OPTIMAL:
      return SolverStatus::kOptimal;
    case CpSolverStatus::FEASIBLE:
      return SolverStatus::kFeasible;
    case CpSolverStatus::INFEASIBLE:
      return SolverStatus::kInfeasible;
    case CpSolverStatus::UNKNOWN:
    default:
      return SolverStatus::kUnknown;
  }
}

}  // namespace

OptimizationResult TrackoraOptimizer::optimize(
    const OptimizationInput& input) const {
  OptimizationResult result;
  const auto solveStart = std::chrono::steady_clock::now();

  if (!ValidateInput(input, &result)) {
    result.solverStatus = SolverStatus::kUnknown;
    result.solveTimeInSeconds =
        std::chrono::duration<double>(std::chrono::steady_clock::now() -
                                      solveStart)
            .count();
    return result;
  }

  CpModelBuilder model;
  std::vector<std::vector<BoolVar>> assignments(input.tasks.size());
  std::vector<BoolVar> activatedBlocks;
  activatedBlocks.reserve(input.windows.size());
  for (const BlockWindow& window : input.windows) {
    activatedBlocks.push_back(model.NewBoolVar().WithName("y_" + window.windowId));
  }

  std::unordered_map<std::string, int> windowIndexById;
  for (int i = 0; i < static_cast<int>(input.windows.size()); ++i) {
    windowIndexById.emplace(input.windows[i].windowId, i);
  }
  std::unordered_map<std::string, const Resource*> resourceById;
  for (const Resource& resource : input.resources) {
    resourceById.emplace(resource.resourceId, &resource);
  }

  std::vector<ObjectiveCandidate> candidates;
  std::vector<std::vector<BoolVar>> windowAssignments(input.windows.size());
  std::vector<std::vector<BoolVar>> resourceAssignments(input.resources.size());
  std::unordered_map<std::string, int> resourceIndexById;
  for (int i = 0; i < static_cast<int>(input.resources.size()); ++i) {
    resourceIndexById.emplace(input.resources[i].resourceId, i);
  }

  for (int taskIndex = 0; taskIndex < static_cast<int>(input.tasks.size());
       ++taskIndex) {
    const MaintenanceTask& task = input.tasks[taskIndex];
    std::unordered_set<int> seenWindows;
    for (const std::string& windowId : task.candidateWindowIds) {
      const int windowIndex = windowIndexById.at(windowId);
      if (!seenWindows.insert(windowIndex).second) {
        continue;
      }
      const BlockWindow& window = input.windows[windowIndex];
      const std::string label = CandidateLabel(task, window);
      bool valid = true;
      std::string rejection;
      if (task.corridorId != window.corridorId) {
        rejection = "REJECTED: Corridor mismatch";
      } else if (!window.weatherAllowed) {
        rejection = "REJECTED: Weather restriction";
      } else if (task.durationMinutes > window.endMinute - window.startMinute) {
        rejection = "REJECTED: Duration does not fit";
      } else {
        for (const TrainMovement& train : input.trains) {
          if (train.corridorId == task.corridorId &&
              Overlaps(window.startMinute, window.endMinute, train.startMinute,
                       train.endMinute)) {
            rejection = "REJECTED: Train conflict";
            break;
          }
        }
      }

      for (const std::string& resourceId : task.requiredResourceIds) {
        const Resource& resource = *resourceById.at(resourceId);
        if (resource.corridorId != task.corridorId ||
            resource.availableFrom > window.startMinute ||
            resource.availableTo < window.endMinute) {
          valid = false;
          rejection = "REJECTED: Resource unavailable";
          break;
        }
      }
      if (!rejection.empty()) {
        valid = false;
        AddDiagnostic(&result, label + rejection);
      }
      BoolVar assignment =
          model.NewBoolVar().WithName("x_" + task.taskId + "_" + window.windowId);
      assignments[taskIndex].push_back(assignment);
      model.AddLessOrEqual(assignment, activatedBlocks[windowIndex]);
      if (!valid) {
        model.AddEquality(assignment, 0);
        continue;
      }
      AddDiagnostic(&result, label + "ACCEPTED: Valid candidate");
      candidates.push_back({taskIndex, windowIndex, assignment});
      windowAssignments[windowIndex].push_back(assignment);
      for (const std::string& resourceId : task.requiredResourceIds) {
        resourceAssignments[resourceIndexById.at(resourceId)].push_back(
            assignment);
      }
    }
    model.AddLessOrEqual(LinearExpr::Sum(assignments[taskIndex]), 1);
  }

  for (int windowIndex = 0;
       windowIndex < static_cast<int>(input.windows.size()); ++windowIndex) {
    // Activation is exact: an unused block must not appear in the result.
    model.AddLessOrEqual(
        activatedBlocks[windowIndex],
        LinearExpr::Sum(windowAssignments[windowIndex]));
    model.AddLessOrEqual(LinearExpr::Sum(windowAssignments[windowIndex]),
                         input.windows[windowIndex].capacity);
  }

  for (int resourceIndex = 0;
       resourceIndex < static_cast<int>(resourceAssignments.size());
       ++resourceIndex) {
    model.AddLessOrEqual(
        LinearExpr::Sum(resourceAssignments[resourceIndex]),
        input.resources[resourceIndex].capacity);
  }

  for (int first = 0; first < static_cast<int>(candidates.size()); ++first) {
    for (int second = first + 1;
         second < static_cast<int>(candidates.size()); ++second) {
      const ObjectiveCandidate& left = candidates[first];
      const ObjectiveCandidate& right = candidates[second];
      const MaintenanceTask& leftTask = input.tasks[left.taskIndex];
      const MaintenanceTask& rightTask = input.tasks[right.taskIndex];
      if (left.windowIndex != right.windowIndex) {
        continue;
      }
      if (leftTask.assetId == rightTask.assetId && !leftTask.assetId.empty()) {
        model.AddLessOrEqual(left.variable + right.variable, 1);
      }
    }
  }

  model.Maximize(
      BuildObjective(&model, input, candidates, activatedBlocks));

  const CpSolverResponse response = operations_research::sat::Solve(
      model.Build(),
      operations_research::sat::SatParameters()
          .set_max_time_in_seconds(input.configuration.maxTimeInSeconds)
          .set_num_search_workers(input.configuration.numSearchWorkers)
          .set_log_search_progress(input.configuration.logSearchProgress));
  result.solverStatus = ConvertStatus(response.status());
  result.objectiveValue = response.objective_value();
  result.solveTimeInSeconds = response.wall_time();

  if (response.status() == CpSolverStatus::OPTIMAL ||
      response.status() == CpSolverStatus::FEASIBLE) {
    for (const ObjectiveCandidate& candidate : candidates) {
      if (!operations_research::sat::SolutionBooleanValue(response,
                                                           candidate.variable)) {
        continue;
      }
      const MaintenanceTask& task = input.tasks[candidate.taskIndex];
      const BlockWindow& window = input.windows[candidate.windowIndex];
      result.selectedAssignments.push_back(
          {task.taskId,
           window.windowId,
           task.assetId,
           task.department,
           task.corridorId,
           window.startMinute,
           window.startMinute + task.durationMinutes,
           task.priorityScore,
           window.windowScore,
           0,
           0});
      ++result.scheduledTaskCount;
    }

    for (const SelectedAssignment& assignment : result.selectedAssignments) {
      const MaintenanceTask* task = nullptr;
      const BlockWindow* window = nullptr;
      for (const MaintenanceTask& candidateTask : input.tasks) {
        if (candidateTask.taskId == assignment.taskId) {
          task = &candidateTask;
          break;
        }
      }
      for (const BlockWindow& candidateWindow : input.windows) {
        if (candidateWindow.windowId == assignment.windowId) {
          window = &candidateWindow;
          break;
        }
      }
      if (task == nullptr || window == nullptr) {
        continue;
      }

      AssignmentExplanation explanation;
      explanation.taskId = assignment.taskId;
      explanation.windowId = assignment.windowId;

      if (task->priorityScore > 0) {
        explanation.reasons.push_back(
            "Maintenance priority score contributed to selection");
      }
      if (window->windowScore > 0) {
        explanation.reasons.push_back(
            "Candidate window suitability score contributed to selection");
      }
      if (task->durationMinutes <= window->endMinute - window->startMinute) {
        explanation.reasons.push_back(
            "Required maintenance duration fits inside the window");
      }
      if (task->corridorId == window->corridorId) {
        explanation.reasons.push_back("Task and window corridors are compatible");
      }
      if (window->weatherAllowed) {
        explanation.reasons.push_back("Weather conditions permit the window");
      }
      explanation.reasons.push_back(
          "No train movement conflicts with the selected window");
      if (!task->requiredResourceIds.empty()) {
        explanation.reasons.push_back(
            "All required resources are available for the selected window");
      }
      if (window->trainDisruptionPenalty == 0) {
        explanation.reasons.push_back("No train disruption penalty applies");
      }
      if (task->assetAvailabilityBenefit > 0) {
        explanation.reasons.push_back(
            "Scheduling improves the configured asset availability benefit");
      }
      if (task->operationalPreference > 0) {
        explanation.reasons.push_back(
            "Configured operational preference favors this assignment");
      }

      for (const SelectedAssignment& other : result.selectedAssignments) {
        if (other.taskId == assignment.taskId ||
            other.windowId != assignment.windowId ||
            other.department == assignment.department ||
            other.corridorId != assignment.corridorId) {
          continue;
        }
        explanation.reasons.push_back(
            "Compatible department work is bundled in the same block");
        break;
      }
      result.assignmentExplanations.push_back(std::move(explanation));
    }

    for (int index = 0; index < static_cast<int>(activatedBlocks.size());
         ++index) {
      if (operations_research::sat::SolutionBooleanValue(
              response, activatedBlocks[index])) {
        result.activatedBlockIds.push_back(input.windows[index].windowId);
      }
    }
  }
  result.unscheduledTaskCount =
      static_cast<int32_t>(input.tasks.size()) - result.scheduledTaskCount;
  if (result.solveTimeInSeconds <= 0.0) {
    result.solveTimeInSeconds =
        std::chrono::duration<double>(std::chrono::steady_clock::now() -
                                      solveStart)
            .count();
  }
  return result;
}

}  // namespace trackora
