#include "json_io.h"
#include "ml_interface.h"
#include "optimizer.h"

#include <fstream>
#include <iostream>
#include <iterator>
#include <string>
#include <vector>

namespace {

const char* StatusName(trackora::SolverStatus status) {
  switch (status) {
    case trackora::SolverStatus::kOptimal:
      return "OPTIMAL";
    case trackora::SolverStatus::kFeasible:
      return "FEASIBLE";
    case trackora::SolverStatus::kInfeasible:
      return "INFEASIBLE";
    case trackora::SolverStatus::kUnknown:
    default:
      return "UNKNOWN";
  }
}

bool ReadFile(const std::string& path, std::string* contents,
              std::string* error) {
  std::ifstream file(path, std::ios::binary);
  if (!file) {
    *error = "Unable to open input file: " + path;
    return false;
  }
  *contents = std::string(std::istreambuf_iterator<char>(file),
                          std::istreambuf_iterator<char>());
  return true;
}

bool WriteFile(const std::string& path, const std::string& contents,
               std::string* error) {
  std::ofstream file(path, std::ios::binary | std::ios::trunc);
  if (!file) {
    *error = "Unable to open output file: " + path;
    return false;
  }
  file << contents;
  if (!file) {
    *error = "Unable to write output file: " + path;
    return false;
  }
  return true;
}

void PrintResult(const trackora::OptimizationResult& result) {
  std::cout << "Solver status: " << StatusName(result.solverStatus) << '\n'
            << "Scheduled tasks: " << result.scheduledTaskCount << '\n'
            << "Unscheduled tasks: " << result.unscheduledTaskCount << '\n'
            << "Objective value: " << result.objectiveValue << '\n'
            << "Solve time: " << result.solveTimeInSeconds << " seconds\n";
  for (const auto& assignment : result.selectedAssignments) {
    std::cout << "Scheduled: " << assignment.taskId << " -> "
              << assignment.windowId << '\n';
  }
  for (const std::string& diagnostic : result.diagnosticMessages) {
    std::cout << "Diagnostic: " << diagnostic << '\n';
  }
}

}  // namespace

int main(int argc, char* argv[]) {
  const std::string inputPath = argc > 1 ? argv[1] : "data/input.json";
  const std::string outputPath = argc > 2 ? argv[2] : "data/output.json";

  std::string json;
  std::string error;
  if (!ReadFile(inputPath, &json, &error)) {
    std::cerr << error << '\n';
    return 1;
  }

  trackora::OptimizationInput input;
  std::vector<std::string> errors;
  if (!trackora::OptimizationInputFromJson(json, &input, &errors)) {
    std::cerr << "Input JSON validation failed:\n";
    for (const std::string& validationError : errors) {
      std::cerr << "- " << validationError << '\n';
    }
    return 1;
  }
  if (!trackora::ValidateMlPredictions(input, &errors)) {
    std::cerr << "ML score validation failed:\n";
    for (const std::string& validationError : errors) {
      std::cerr << "- " << validationError << '\n';
    }
    return 1;
  }

  const trackora::OptimizationResult result =
      trackora::TrackoraOptimizer().optimize(input);
  PrintResult(result);

  if (!WriteFile(outputPath, trackora::OptimizationResultToJson(result),
                 &error)) {
    std::cerr << error << '\n';
    return 1;
  }
  return result.solverStatus == trackora::SolverStatus::kUnknown ||
                 result.solverStatus == trackora::SolverStatus::kInfeasible
             ? 2
             : 0;
}
