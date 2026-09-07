#include "json_io.h"

#include <cctype>
#include <cstdint>
#include <iomanip>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace trackora {
namespace {

struct JsonValue {
  enum class Type { kNull, kBool, kNumber, kString, kArray, kObject };
  Type type = Type::kNull;
  bool boolean = false;
  int64_t number = 0;
  double decimal = 0.0;
  std::string string;
  std::vector<JsonValue> array;
  std::vector<std::pair<std::string, JsonValue>> object;
};

class JsonParser {
 public:
  explicit JsonParser(const std::string& text) : text_(text) {}

  JsonValue Parse() {
    SkipSpace();
    JsonValue value = ParseValue();
    SkipSpace();
    if (position_ != text_.size()) {
      Fail("unexpected characters after JSON value");
    }
    return value;
  }

 private:
  void SkipSpace() {
    while (position_ < text_.size() &&
           std::isspace(static_cast<unsigned char>(text_[position_]))) {
      ++position_;
    }
  }

  void Fail(const std::string& message) const {
    throw std::runtime_error(message + " at character " +
                             std::to_string(position_));
  }

  void Expect(char expected) {
    SkipSpace();
    if (position_ >= text_.size() || text_[position_] != expected) {
      Fail(std::string("expected '") + expected + "'");
    }
    ++position_;
  }

  JsonValue ParseValue() {
    SkipSpace();
    if (position_ >= text_.size()) {
      Fail("unexpected end of JSON");
    }
    switch (text_[position_]) {
      case '{':
        return ParseObject();
      case '[':
        return ParseArray();
      case '"':
        return StringValue(ParseString());
      case 't':
        return Literal("true", true);
      case 'f':
        return Literal("false", false);
      case 'n':
        ParseLiteral("null");
        return JsonValue{};
      default:
        if (text_[position_] == '-' ||
            std::isdigit(static_cast<unsigned char>(text_[position_]))) {
          return ParseNumber();
        }
        Fail("invalid JSON value");
    }
    return JsonValue{};
  }

  JsonValue ParseObject() {
    JsonValue value;
    value.type = JsonValue::Type::kObject;
    Expect('{');
    SkipSpace();
    if (position_ < text_.size() && text_[position_] == '}') {
      ++position_;
      return value;
    }
    while (true) {
      SkipSpace();
      if (position_ >= text_.size() || text_[position_] != '"') {
        Fail("object key must be a string");
      }
      std::string key = ParseString();
      Expect(':');
      value.object.emplace_back(std::move(key), ParseValue());
      SkipSpace();
      if (position_ < text_.size() && text_[position_] == '}') {
        ++position_;
        return value;
      }
      Expect(',');
    }
  }

  JsonValue ParseArray() {
    JsonValue value;
    value.type = JsonValue::Type::kArray;
    Expect('[');
    SkipSpace();
    if (position_ < text_.size() && text_[position_] == ']') {
      ++position_;
      return value;
    }
    while (true) {
      value.array.push_back(ParseValue());
      SkipSpace();
      if (position_ < text_.size() && text_[position_] == ']') {
        ++position_;
        return value;
      }
      Expect(',');
    }
  }

  std::string ParseString() {
    Expect('"');
    std::string result;
    while (position_ < text_.size()) {
      const char character = text_[position_++];
      if (character == '"') {
        return result;
      }
      if (character == '\\') {
        if (position_ >= text_.size()) {
          Fail("unterminated escape");
        }
        const char escaped = text_[position_++];
        switch (escaped) {
          case '"': case '\\': case '/': result += escaped; break;
          case 'n': result += '\n'; break;
          case 'r': result += '\r'; break;
          case 't': result += '\t'; break;
          default: Fail("unsupported string escape");
        }
      } else {
        result += character;
      }
    }
    Fail("unterminated string");
    return {};
  }

  JsonValue ParseNumber() {
    const size_t start = position_;
    if (text_[position_] == '-') ++position_;
    while (position_ < text_.size() &&
           std::isdigit(static_cast<unsigned char>(text_[position_]))) ++position_;
    bool decimal = false;
    if (position_ < text_.size() && text_[position_] == '.') {
      decimal = true;
      ++position_;
      while (position_ < text_.size() &&
             std::isdigit(static_cast<unsigned char>(text_[position_]))) ++position_;
    }
    const std::string token = text_.substr(start, position_ - start);
    JsonValue value;
    value.type = JsonValue::Type::kNumber;
    try {
      if (decimal) value.decimal = std::stod(token);
      else {
        value.number = std::stoll(token);
        value.decimal = static_cast<double>(value.number);
      }
    } catch (const std::exception&) {
      Fail("invalid number");
    }
    return value;
  }

  void ParseLiteral(const std::string& literal) {
    if (text_.compare(position_, literal.size(), literal) != 0) {
      Fail("invalid literal");
    }
    position_ += literal.size();
  }

  JsonValue Literal(const std::string& literal, bool boolean) {
    ParseLiteral(literal);
    JsonValue value;
    value.type = JsonValue::Type::kBool;
    value.boolean = boolean;
    return value;
  }

  static JsonValue StringValue(std::string value) {
    JsonValue result;
    result.type = JsonValue::Type::kString;
    result.string = std::move(value);
    return result;
  }

  const std::string& text_;
  size_t position_ = 0;
};

const JsonValue& Required(const JsonValue& object, const std::string& key) {
  if (object.type != JsonValue::Type::kObject) {
    throw std::runtime_error("expected JSON object");
  }
  for (const auto& entry : object.object) {
    if (entry.first == key) return entry.second;
  }
  throw std::runtime_error("missing required field: " + key);
}

const JsonValue* Optional(const JsonValue& object, const std::string& key) {
  if (object.type != JsonValue::Type::kObject) return nullptr;
  for (const auto& entry : object.object) {
    if (entry.first == key) return &entry.second;
  }
  return nullptr;
}

std::string String(const JsonValue& value, const std::string& field) {
  if (value.type != JsonValue::Type::kString) throw std::runtime_error(field + " must be a string");
  return value.string;
}
int64_t Integer(const JsonValue& value, const std::string& field) {
  if (value.type != JsonValue::Type::kNumber) throw std::runtime_error(field + " must be a number");
  return value.number;
}
bool Boolean(const JsonValue& value, const std::string& field) {
  if (value.type != JsonValue::Type::kBool) throw std::runtime_error(field + " must be boolean");
  return value.boolean;
}
const std::vector<JsonValue>& Array(const JsonValue& value, const std::string& field) {
  if (value.type != JsonValue::Type::kArray) throw std::runtime_error(field + " must be an array");
  return value.array;
}

template <typename T, typename F>
void ReadArray(const JsonValue& root, const std::string& field,
               std::vector<T>* output, F reader) {
  for (const JsonValue& item : Array(Required(root, field), field)) {
    output->push_back(reader(item));
  }
}

std::string Escape(const std::string& value) {
  std::ostringstream output;
  for (char character : value) {
    if (character == '"' || character == '\\') output << '\\';
    output << character;
  }
  return output.str();
}

void WriteStringArray(std::ostringstream& out,
                      const std::vector<std::string>& values) {
  out << '[';
  for (size_t i = 0; i < values.size(); ++i) {
    if (i != 0) out << ',';
    out << '"' << Escape(values[i]) << '"';
  }
  out << ']';
}

}  // namespace

bool OptimizationInputFromJson(const std::string& json,
                               OptimizationInput* input,
                               std::vector<std::string>* errors) {
  if (input == nullptr || errors == nullptr) return false;
  errors->clear();
  try {
    const JsonValue root = JsonParser(json).Parse();
    *input = OptimizationInput{};
    for (const JsonValue& item : Array(Required(root, "tasks"), "tasks")) {
      MaintenanceTask task;
      task.taskId = String(Required(item, "taskId"), "taskId");
      task.assetId = String(Required(item, "assetId"), "assetId");
      task.department = String(Required(item, "department"), "department");
      task.corridorId = String(Required(item, "corridorId"), "corridorId");
      task.durationMinutes = Integer(Required(item, "durationMinutes"), "durationMinutes");
      task.priorityScore = Integer(Required(item, "priorityScore"), "priorityScore");
      task.safetyCritical = Boolean(Required(item, "safetyCritical"), "safetyCritical");
      for (const auto& v : Array(Required(item, "requiredResourceIds"), "requiredResourceIds"))
        task.requiredResourceIds.push_back(String(v, "requiredResourceIds"));
      for (const auto& v : Array(Required(item, "candidateWindowIds"), "candidateWindowIds"))
        task.candidateWindowIds.push_back(String(v, "candidateWindowIds"));
      input->tasks.push_back(std::move(task));
    }
    ReadArray(root, "windows", &input->windows, [](const JsonValue& item) {
      BlockWindow v;
      v.windowId = String(Required(item, "windowId"), "windowId");
      v.corridorId = String(Required(item, "corridorId"), "corridorId");
      v.startMinute = Integer(Required(item, "startMinute"), "startMinute");
      v.endMinute = Integer(Required(item, "endMinute"), "endMinute");
      v.capacity = Integer(Required(item, "capacity"), "capacity");
      v.weatherAllowed = Boolean(Required(item, "weatherAllowed"), "weatherAllowed");
      v.windowScore = Integer(Required(item, "windowScore"), "windowScore");
      return v;
    });
    ReadArray(root, "trains", &input->trains, [](const JsonValue& item) {
      TrainMovement v;
      v.trainId = String(Required(item, "trainId"), "trainId");
      v.corridorId = String(Required(item, "corridorId"), "corridorId");
      v.startMinute = Integer(Required(item, "startMinute"), "startMinute");
      v.endMinute = Integer(Required(item, "endMinute"), "endMinute");
      v.priority = Integer(Required(item, "priority"), "priority");
      return v;
    });
    ReadArray(root, "resources", &input->resources, [](const JsonValue& item) {
      Resource v;
      v.resourceId = String(Required(item, "resourceId"), "resourceId");
      v.resourceType = String(Required(item, "resourceType"), "resourceType");
      v.availableFrom = Integer(Required(item, "availableFrom"), "availableFrom");
      v.availableTo = Integer(Required(item, "availableTo"), "availableTo");
      v.corridorId = String(Required(item, "corridorId"), "corridorId");
      v.capacity = Integer(Required(item, "capacity"), "capacity");
      return v;
    });
    const JsonValue& config = Required(root, "configuration");
    input->configuration.maxTimeInSeconds =
        Optional(config, "maxTimeInSeconds") ? Optional(config, "maxTimeInSeconds")->decimal
                                             : 30.0;
    input->configuration.numSearchWorkers =
        Optional(config, "numSearchWorkers")
            ? Integer(*Optional(config, "numSearchWorkers"), "numSearchWorkers") : 1;
    input->configuration.logSearchProgress =
        Optional(config, "logSearchProgress")
            ? Boolean(*Optional(config, "logSearchProgress"), "logSearchProgress") : false;
    if (const JsonValue* ml = Optional(root, "mlScores")) {
      if (const JsonValue* tasks = Optional(*ml, "maintenanceTasks")) {
        for (const JsonValue& item : Array(*tasks, "maintenanceTasks")) {
          MaintenanceTaskPrediction prediction;
          prediction.taskId = String(Required(item, "taskId"), "taskId");
          prediction.maintenancePriorityScore =
              Integer(Required(item, "maintenancePriorityScore"),
                      "maintenancePriorityScore");
          if (const JsonValue* value = Optional(item, "riskScore"))
            prediction.riskScore = Integer(*value, "riskScore");
          if (const JsonValue* value =
                  Optional(item, "assetAvailabilityBenefit"))
            prediction.assetAvailabilityBenefit =
                Integer(*value, "assetAvailabilityBenefit");
          if (const JsonValue* value = Optional(item, "coordinationScore"))
            prediction.coordinationScore =
                Integer(*value, "coordinationScore");
          input->mlPredictions.maintenanceTasks.push_back(prediction);
        }
      }
      if (const JsonValue* windows = Optional(*ml, "candidateWindows")) {
        for (const JsonValue& item : Array(*windows, "candidateWindows")) {
          CandidateWindowPrediction prediction;
          prediction.taskId = String(Required(item, "taskId"), "taskId");
          prediction.windowId = String(Required(item, "windowId"), "windowId");
          prediction.candidateWindowScore =
              Integer(Required(item, "candidateWindowScore"),
                      "candidateWindowScore");
          input->mlPredictions.candidateWindows.push_back(prediction);
        }
      }
    }
    return true;
  } catch (const std::exception& exception) {
    errors->push_back(exception.what());
    return false;
  }
}

std::string OptimizationResultToJson(const OptimizationResult& result) {
  std::ostringstream out;
  out << "{\n  \"solverStatus\":\"";
  switch (result.solverStatus) {
    case SolverStatus::kOptimal: out << "OPTIMAL"; break;
    case SolverStatus::kFeasible: out << "FEASIBLE"; break;
    case SolverStatus::kInfeasible: out << "INFEASIBLE"; break;
    default: out << "UNKNOWN"; break;
  }
  out << "\",\n  \"selectedBlocks\":";
  WriteStringArray(out, result.activatedBlockIds);
  out << ",\n  \"selectedTasks\":[";
  for (size_t i = 0; i < result.selectedAssignments.size(); ++i) {
    if (i != 0) out << ',';
    const auto& task = result.selectedAssignments[i];
    out << "{\"taskId\":\"" << Escape(task.taskId) << "\",\"windowId\":\""
        << Escape(task.windowId) << "\",\"assetId\":\"" << Escape(task.assetId)
        << "\",\"corridorId\":\"" << Escape(task.corridorId) << "\",\"startMinute\":"
        << task.startMinute << ",\"endMinute\":" << task.endMinute << '}';
  }
  out << "],\n  \"unscheduledTasks\":[]"
      << ",\n  \"objectiveValue\":" << result.objectiveValue
      << ",\n  \"scheduledTaskCount\":" << result.scheduledTaskCount
      << ",\n  \"unscheduledTaskCount\":" << result.unscheduledTaskCount
      << ",\n  \"activatedBlockCount\":" << result.activatedBlockIds.size()
      << ",\n  \"solveTime\":" << std::setprecision(12) << result.solveTimeInSeconds
      << ",\n  \"explanations\":[";
  for (size_t i = 0; i < result.assignmentExplanations.size(); ++i) {
    if (i != 0) out << ',';
    const auto& explanation = result.assignmentExplanations[i];
    out << "{\"taskId\":\"" << Escape(explanation.taskId) << "\",\"windowId\":\""
        << Escape(explanation.windowId) << "\",\"reasons\":";
    WriteStringArray(out, explanation.reasons);
    out << '}';
  }
  out << "],\n  \"diagnostics\":";
  WriteStringArray(out, result.diagnosticMessages);
  out << "\n}\n";
  return out.str();
}

}  // namespace trackora
