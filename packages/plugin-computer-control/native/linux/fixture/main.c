// The test-only GTK app the end-to-end tests drive. Each part exists for one behaviour (see docs/computer-use-linux.md).
#include <gtk/gtk.h>

static GtkWidget *status, *pad_log, *key_log, *loaded;
static int presses, stubborn;
static double press_x, press_y;

static void named(GtkWidget *widget, const char *name) { atk_object_set_name(gtk_widget_get_accessible(widget), name); }

static void on_press(GtkButton *button, gpointer data) {
  (void)button; (void)data;
  char text[32];
  g_snprintf(text, sizeof text, "Pressed %d", ++presses);
  gtk_label_set_text(GTK_LABEL(status), text);
}

static gboolean on_pad_press(GtkWidget *widget, GdkEventButton *event, gpointer data) {
  (void)widget; (void)data;
  if (event->type != GDK_BUTTON_PRESS && event->type != GDK_2BUTTON_PRESS) return TRUE;
  press_x = event->x;
  press_y = event->y;
  char text[64];
  g_snprintf(text, sizeof text, "%s button %u%s", event->type == GDK_2BUTTON_PRESS ? "double" : "click", event->button,
             event->state & GDK_SHIFT_MASK ? " shift" : "");
  gtk_label_set_text(GTK_LABEL(pad_log), text);
  return TRUE;
}

static gboolean on_pad_release(GtkWidget *widget, GdkEventButton *event, gpointer data) {
  (void)widget; (void)data;
  const double dx = event->x - press_x, dy = event->y - press_y;
  if (dx * dx + dy * dy < 100) return TRUE;
  char text[64];
  g_snprintf(text, sizeof text, "drag %s %s", dx > 20 ? "right" : dx < -20 ? "left" : "none", dy > 20 ? "down" : dy < -20 ? "up" : "none");
  gtk_label_set_text(GTK_LABEL(pad_log), text);
  return TRUE;
}

static gboolean on_pad_scroll(GtkWidget *widget, GdkEventScroll *event, gpointer data) {
  (void)widget; (void)data;
  static int count;
  const char *way = event->direction == GDK_SCROLL_UP ? "up" : event->direction == GDK_SCROLL_DOWN ? "down" : event->direction == GDK_SCROLL_LEFT ? "left" : "right";
  char text[64];
  g_snprintf(text, sizeof text, "scroll %s %d", way, ++count);
  gtk_label_set_text(GTK_LABEL(pad_log), text);
  return TRUE;
}

static gboolean on_pad_draw(GtkWidget *widget, cairo_t *cairo, gpointer data) {
  (void)data;
  cairo_set_source_rgb(cairo, 0.85, 0.9, 1.0);
  cairo_rectangle(cairo, 0, 0, gtk_widget_get_allocated_width(widget), gtk_widget_get_allocated_height(widget));
  cairo_fill(cairo);
  return FALSE;
}

static gboolean on_key(GtkWidget *widget, GdkEventKey *event, gpointer data) {
  (void)widget; (void)data;
  if (!(event->state & GDK_CONTROL_MASK) || event->keyval == GDK_KEY_Control_L) return FALSE;
  char text[64];
  g_snprintf(text, sizeof text, "key ctrl+%s", gdk_keyval_name(event->keyval));
  gtk_label_set_text(GTK_LABEL(key_log), text);
  return TRUE;
}

// A control that takes an accessibility press and does nothing with it; only a real click counts.
static gboolean on_stubborn(GtkWidget *widget, GdkEventButton *event, gpointer data) {
  (void)event; (void)data;
  char text[32];
  g_snprintf(text, sizeof text, "Stubborn %d", ++stubborn);
  gtk_button_set_label(GTK_BUTTON(widget), text);
  return TRUE;
}

static gboolean on_loaded(gpointer data) {
  (void)data;
  gtk_label_set_text(GTK_LABEL(loaded), "Loaded");
  return G_SOURCE_REMOVE;
}

int main(int argc, char **argv) {
  gtk_init(&argc, &argv);
  GtkWidget *window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
  gtk_window_set_title(GTK_WINDOW(window), "Moxxy Fixture");
  gtk_window_set_default_size(GTK_WINDOW(window), 420, 520);
  g_signal_connect(window, "destroy", G_CALLBACK(gtk_main_quit), NULL);
  g_signal_connect(window, "key-press-event", G_CALLBACK(on_key), NULL);
  GtkWidget *box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 6);
  gtk_container_set_border_width(GTK_CONTAINER(box), 10);
  gtk_container_add(GTK_CONTAINER(window), box);

  GtkWidget *name = gtk_entry_new();
  gtk_entry_set_text(GTK_ENTRY(name), "hello");
  named(name, "Name");
  GtkWidget *secret = gtk_entry_new();
  gtk_entry_set_visibility(GTK_ENTRY(secret), FALSE);
  gtk_entry_set_text(GTK_ENTRY(secret), "hunter2");
  named(secret, "Secret");
  GtkWidget *press = gtk_button_new_with_label("Press");
  g_signal_connect(press, "clicked", G_CALLBACK(on_press), NULL);
  status = gtk_label_new("Ready");
  GtkWidget *remember = gtk_check_button_new_with_label("Remember");
  gtk_toggle_button_set_active(GTK_TOGGLE_BUTTON(remember), TRUE);
  GtkWidget *disabled = gtk_button_new_with_label("Disabled");
  gtk_widget_set_sensitive(disabled, FALSE);
  GtkWidget *amount = gtk_spin_button_new_with_range(0, 10, 1);
  gtk_spin_button_set_value(GTK_SPIN_BUTTON(amount), 3);
  named(amount, "Amount");
  GtkWidget *dud = gtk_button_new_with_label("Dud");
  GtkWidget *stubborn_button = gtk_button_new_with_label("Stubborn 0");
  g_signal_connect(stubborn_button, "button-press-event", G_CALLBACK(on_stubborn), NULL);
  loaded = gtk_label_new("Loading");
  g_timeout_add(600, on_loaded, NULL);
  GtkWidget *pad = gtk_drawing_area_new();
  gtk_widget_set_size_request(pad, 380, 140);
  gtk_widget_add_events(pad, GDK_BUTTON_PRESS_MASK | GDK_BUTTON_RELEASE_MASK | GDK_SCROLL_MASK);
  g_signal_connect(pad, "draw", G_CALLBACK(on_pad_draw), NULL);
  g_signal_connect(pad, "button-press-event", G_CALLBACK(on_pad_press), NULL);
  g_signal_connect(pad, "button-release-event", G_CALLBACK(on_pad_release), NULL);
  g_signal_connect(pad, "scroll-event", G_CALLBACK(on_pad_scroll), NULL);
  named(pad, "Pad");
  pad_log = gtk_label_new("pad idle");
  key_log = gtk_label_new("key none");

  GtkWidget *parts[] = {name, secret, press, status, remember, disabled, amount, dud, stubborn_button, loaded, pad, pad_log, key_log};
  for (size_t index = 0; index < G_N_ELEMENTS(parts); index++) gtk_box_pack_start(GTK_BOX(box), parts[index], FALSE, FALSE, 0);
  gtk_widget_show_all(window);
  gtk_main();
  return 0;
}
