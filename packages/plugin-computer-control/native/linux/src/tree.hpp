#pragma once
#include <map>
#include <optional>
#include <string>
#include <vector>

#include "geometry.hpp"
#include "json.hpp"

namespace moxxy {

/// One accessibility element as read from AT-SPI, before pruning. `handle` points into the reader's
/// table of live elements, so actions can reach the element later.
struct Node {
  /// The AT-SPI role name, e.g. "push button".
  std::string role;
  std::string name;
  std::string description;
  std::string identifier;
  /// Never read for secure fields.
  std::optional<std::string> value;
  bool secure = false;
  bool enabled = true;
  bool focused = false;
  bool selected = false;
  /// Set for elements that can be checked.
  std::optional<bool> checked;
  /// Set for elements that can be expanded.
  std::optional<bool> expanded;
  std::vector<std::string> actions;
  /// Screen pixels.
  std::optional<Rect> frame;
  int handle = -1;
  std::vector<Node> children;
};

/// An element as the model sees it (see `appTreeSchema` in `src/contract/tree.ts`), minus its index.
struct Element {
  std::string key;
  int depth;
  std::string role;
  std::optional<std::string> title;
  std::optional<std::string> description;
  std::optional<std::string> value;
  bool secure;
  std::vector<std::string> states;
  std::vector<std::string> actions;
  int handle;
  std::optional<Rect> frame;
};

struct BuiltTree {
  std::vector<Element> elements;
  bool truncated = false;
};

/// Lists what the model can read or act on, at most `limit` elements, depth first.
BuiltTree build_tree(const Node& root, size_t limit);

/// Whether a plain click on this element is the same as its own accessibility action.
bool pressable(const std::string& role);
/// The accessibility action a plain click stands for, when the element has one.
std::optional<std::string> press_action(const std::vector<std::string>& actions);

/// Element indices for one app: an index lives as long as its key and is never handed to another element.
class IndexRegistry {
 public:
  std::vector<int> assign(const std::vector<std::string>& keys);

 private:
  std::map<std::string, int> indices_;
  int next_ = 0;
};

/// The element last observed under a screen point: the smallest frame that contains it.
std::optional<int> element_at(double x, double y, const std::map<int, Rect>& frames);

/// One element in the contract's shape; its frame is given in the pixels of `frame`'s picture.
Json element_json(const Element& element, int index, const std::optional<ImageFrame>& frame);

}  // namespace moxxy
