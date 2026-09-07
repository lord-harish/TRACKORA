#include "json_io.h"

#include <cassert>
#include <string>
#include <vector>

int main() {
  const std::string validJson =
      R"({"tasks":[],"windows":[],"trains":[],"resources":[],"configuration":{}})";
  trackora::OptimizationInput input;
  std::vector<std::string> errors;
  assert(trackora::OptimizationInputFromJson(validJson, &input, &errors));
  assert(errors.empty());

  assert(!trackora::OptimizationInputFromJson(
      R"({"tasks":[]})", &input, &errors));
  assert(!errors.empty());
  return 0;
}
