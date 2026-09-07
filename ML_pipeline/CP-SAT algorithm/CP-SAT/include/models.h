#pragma once

#include "config.h"

#include <cstdint>
#include <string>
#include <vector>

namespace trackora {

struct MaintenanceTask {
  std::string taskId;
  std::string assetId;
  std::string department;
  std::string corridorId;
  int32_t durationMinutes = 0;
  int64_t priorityScore = 0;
  bool safetyCritical = false;
  std::vector<std::string> requiredResourceIds;
  std::vector<std::string> candidateWindowIds;
  int64_t assetAvailabilityBenefit = 0;
  int64_t coordinationScore = 0;
  int64_t operationalPreference = 0;
  int64_t resourcePenalty = 0;
  int64_t unnecessaryDowntimePenalty = 0;
};

struct BlockWindow {
  std::string windowId;
  std::string corridorId;
  int32_t startMinute = 0;
  int32_t endMinute = 0;
  int32_t capacity = 1;
  bool weatherAllowed = true;
  int64_t windowScore = 0;
  int64_t trainDisruptionPenalty = 0;
  int64_t activationCost = 0;
};

struct TrainMovement {
  std::string trainId;
  std::string corridorId;
  int32_t startMinute = 0;
  int32_t endMinute = 0;
  int32_t priority = 0;
};

struct Resource {
  std::string resourceId;
  std::string resourceType;
  int32_t availableFrom = 0;
  int32_t availableTo = 0;
  std::string corridorId;
  int32_t capacity = 1;
};

// Random Forest output associated with one maintenance task.
struct MaintenanceTaskPrediction {
  std::string taskId;
  int64_t maintenancePriorityScore = 0;
  int64_t riskScore = 0;
  int64_t assetAvailabilityBenefit = 0;
  int64_t coordinationScore = 0;
};

// XGBRanker output associated with one task/window candidate pair.
struct CandidateWindowPrediction {
  std::string taskId;
  std::string windowId;
  int64_t candidateWindowScore = 0;
};

// Transport-neutral prediction payload. A future JSON or REST adapter can
// deserialize directly into this type without coupling ML to CP-SAT.
struct MlPredictionInput {
  std::vector<MaintenanceTaskPrediction> maintenanceTasks;
  std::vector<CandidateWindowPrediction> candidateWindows;
};

struct OptimizationInput {
  std::vector<MaintenanceTask> tasks;
  std::vector<BlockWindow> windows;
  std::vector<TrainMovement> trains;
  std::vector<Resource> resources;
  SolverConfig configuration;
  MlPredictionInput mlPredictions;
};

enum class SolverStatus {
  kOptimal,
  kFeasible,
  kInfeasible,
  kUnknown
};

struct SelectedAssignment {
  std::string taskId;
  std::string windowId;
  std::string assetId;
  std::string department;
  std::string corridorId;
  int32_t startMinute = 0;
  int32_t endMinute = 0;
  int64_t priorityScore = 0;
  int64_t windowScore = 0;
  int64_t coordinationBenefit = 0;
  int64_t objectiveContribution = 0;
};

struct AssignmentExplanation {
  std::string taskId;
  std::string windowId;
  std::vector<std::string> reasons;
};

struct OptimizationResult {
  SolverStatus solverStatus = SolverStatus::kUnknown;
  std::vector<SelectedAssignment> selectedAssignments;
  std::vector<AssignmentExplanation> assignmentExplanations;
  std::vector<std::string> activatedBlockIds;
  int32_t scheduledTaskCount = 0;
  int32_t unscheduledTaskCount = 0;
  int64_t objectiveValue = 0;
  double solveTimeInSeconds = 0.0;
  std::vector<std::string> diagnosticMessages;
};

}  // namespace trackora
