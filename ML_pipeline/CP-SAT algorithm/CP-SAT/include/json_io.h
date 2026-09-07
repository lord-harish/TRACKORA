#pragma once

#include "models.h"

#include <string>
#include <vector>

namespace trackora {

bool OptimizationInputFromJson(const std::string& json,
                               OptimizationInput* input,
                               std::vector<std::string>* errors);

std::string OptimizationResultToJson(const OptimizationResult& result);

}  // namespace trackora
