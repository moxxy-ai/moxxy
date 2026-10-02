#include "check.hpp"
#include "apps.hpp"

using namespace moxxy;

namespace {
const AppRecord calculator{"org.gnome.Calculator", "Calculator", "gnome-calculator", "", false};
const AppRecord files{"org.gnome.Nautilus", "Files", "nautilus", "org.gnome.Nautilus", false};
const AppRecord chrome{"google-chrome", "Google Chrome", "google-chrome-stable", "Google-chrome", false};
}  // namespace

TEST(a_window_belongs_to_the_app_whose_program_or_class_it_has) {
  CHECK(catalog::owns(calculator, {"gnome-calculator", "Gnome-calculator", {"gnome-calculator"}}));
  CHECK(catalog::owns(files, {"org.gnome.Nautilus", "org.gnome.Nautilus", {"nautilus"}}));
  CHECK(catalog::owns(chrome, {"google-chrome", "Google-chrome", {"chrome"}}));
  // A script: the interpreter is the executable, the program is its first argument.
  CHECK(catalog::owns({"meld", "Meld", "meld", "", false}, {"x", "X", {"python3", "meld"}}));
  CHECK(!catalog::owns(calculator, {"xterm", "XTerm", {"xterm"}}));
  CHECK(!catalog::owns({"empty", "Empty", "", "", false}, {"", "", {""}}));
}

TEST(running_apps_come_first_and_replace_their_installed_copy) {
  auto running = calculator;
  running.running = true;
  const auto merged = catalog::merge({running}, {files, calculator});
  CHECK(merged.size() == 2);
  CHECK(merged[0].id == "org.gnome.Calculator" && merged[0].running);
  CHECK(merged[1].id == "org.gnome.Nautilus");
}

TEST(a_query_filters_by_name_id_and_program_and_a_limit_truncates) {
  const std::vector<AppRecord> apps{calculator, files, chrome};
  CHECK(catalog::page(apps, "NAUT", 10).apps.size() == 1);
  CHECK(catalog::page(apps, "chrome-stable", 10).apps.size() == 1);
  const auto page = catalog::page(apps, "", 2);
  CHECK(page.apps.size() == 2 && page.truncated);
}

TEST(an_app_is_resolved_by_id_name_or_program) {
  const std::vector<AppRecord> apps{calculator, files, chrome};
  CHECK(std::get<AppRecord>(catalog::resolve("org.gnome.calculator", apps)).id == "org.gnome.Calculator");
  CHECK(std::get<AppRecord>(catalog::resolve("files", apps)).id == "org.gnome.Nautilus");
  CHECK(std::get<AppRecord>(catalog::resolve("gnome-calculator", apps)).id == "org.gnome.Calculator");
  CHECK(std::get<AppRecord>(catalog::resolve("org.gnome.Nautilus.desktop", apps)).id == "org.gnome.Nautilus");
  CHECK(std::holds_alternative<NotFound>(catalog::resolve("paint", apps)));
  const std::vector<AppRecord> twins{{"a", "Editor", "a", "", false}, {"b", "Editor", "b", "", false}};
  CHECK(std::get<std::vector<AppRecord>>(catalog::resolve("editor", twins)).size() == 2);
}

TEST(the_program_of_a_desktop_file_is_the_first_real_word_of_its_exec_line) {
  CHECK(catalog::program_of("/usr/bin/gnome-calculator %U") == "gnome-calculator");
  CHECK(catalog::program_of("env GDK_BACKEND=x11 /opt/app/run --flag") == "run");
  CHECK(catalog::program_of("\"/opt/My App/app\" %f") == "app");
  CHECK(catalog::program_of("") == "");
}
