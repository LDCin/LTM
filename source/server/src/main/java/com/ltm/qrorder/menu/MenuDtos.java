package com.ltm.qrorder.menu;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.util.List;

public final class MenuDtos {

    private MenuDtos() {
    }

    public record MenuItemDto(long id, long categoryId, String name, String description, long price,
                              String imageUrl, boolean available, Integer stock, String station) {
    }

    public record CategoryDto(long id, String name, int sortOrder, List<MenuItemDto> items) {
    }

    /** Ảnh chụp thực đơn trong cache; version dùng làm ETag. */
    public record MenuSnapshot(long version, List<CategoryDto> categories) {
    }

    public record MenuItemRequest(
            @NotNull Long categoryId,
            @NotBlank @Size(max = 100) String name,
            @Size(max = 500) String description,
            @NotNull @Min(0) Long price,
            @Size(max = 255) String imageUrl,
            @NotNull Boolean available,
            @Min(0) Integer stock,
            @NotNull @Pattern(regexp = "KITCHEN|BAR") String station) {
    }

    public record CategoryRequest(@NotBlank @Size(max = 100) String name, @NotNull Integer sortOrder) {
    }
}
