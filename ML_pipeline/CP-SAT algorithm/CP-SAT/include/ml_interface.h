#pragma once

#include "models.h"

#include <string>
#include <vector>

namespace trackora {

// Validates prediction references before a future adapter forwards them to the
// optimizer. It does not alter scheduling data or perform network operations.
inline bool ValidateMlPredictions(const OptimizationInput& input,
                                  std::vector<std::string>* errors) {
  if (errors == nullptr) {
    return false;
  }
  errors->clear();

  for (const MaintenanceTaskPrediction& prediction :
       input.mlPredictions.maintenanceTasks) {
    bool foundTask = false;
    for (const MaintenanceTask& task : input.tasks) {
      if (task.taskId == prediction.taskId) {
        foundTask = true;
        break;
      }
    }
    if (!foundTask) {
      errors->push_back("ML prediction references unknown task: " +
                        prediction.taskId);
    }
  }

  for (const CandidateWindowPrediction& prediction :
       input.mlPredictions.candidateWindows) {
    bool foundTask = false;
    bool isCandidateWindow = false;
    bool foundWindow = false;
    for (const MaintenanceTask& task : input.tasks) {
      if (task.taskId == prediction.taskId) {
        foundTask = true;
        for (const std::string& candidateWindowId : task.candidateWindowIds) {
          if (candidateWindowId == prediction.windowId) {
            isCandidateWindow = true;
            break;
          }
        }
        break;
      }
    }
    for (const BlockWindow& window : input.windows) {
      if (window.windowId == prediction.windowId) {
        foundWindow = true;
        break;
      }
    }
    if (!foundTask) {
      errors->push_back("ML window prediction references unknown task: " +
                        prediction.taskId);
    }
    if (!foundWindow) {
      errors->push_back("ML window prediction references unknown window: " +
                        prediction.windowId);
    }
    if (foundTask && foundWindow && !isCandidateWindow) {
      errors->push_back("ML window prediction references a non-candidate window: " +
                        prediction.windowId);
    }
  }

  return errors->empty();
}

}  // namespace trackora
