<?php

namespace App\Models;

use App\Http\Traits\ModelOwnedByUserTrait;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * App\Models\ImportProfile
 *
 * @property int $id
 * @property int $user_id
 * @property string $name
 * @property string|null $source_name_pattern
 * @property bool $is_default
 * @property array<string, mixed>|null $csv_options
 * @property array<string, mixed>|null $column_mapping
 * @property array<string, mixed>|null $value_mappings
 * @property array<int, mixed>|null $rules
 * @property-read User $user
 * @method static Builder|ImportProfile newModelQuery()
 * @method static Builder|ImportProfile newQuery()
 * @method static Builder|ImportProfile query()
 * @method static Builder|ImportProfile whereColumnMapping($value)
 * @method static Builder|ImportProfile whereCreatedAt($value)
 * @method static Builder|ImportProfile whereCsvOptions($value)
 * @method static Builder|ImportProfile whereId($value)
 * @method static Builder|ImportProfile whereIsDefault($value)
 * @method static Builder|ImportProfile whereName($value)
 * @method static Builder|ImportProfile whereRules($value)
 * @method static Builder|ImportProfile whereSourceNamePattern($value)
 * @method static Builder|ImportProfile whereUpdatedAt($value)
 * @method static Builder|ImportProfile whereUserId($value)
 * @method static Builder|ImportProfile whereValueMappings($value)
 */
class ImportProfile extends Model
{
    use HasFactory;
    use ModelOwnedByUserTrait;

    /**
     * The attributes that are mass assignable.
     *
     * @var array<string>
     */
    protected $fillable = [
        'name',
        'source_name_pattern',
        'is_default',
        'csv_options',
        'column_mapping',
        'value_mappings',
        'rules',
    ];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'is_default' => 'boolean',
            'csv_options' => 'array',
            'column_mapping' => 'array',
            'value_mappings' => 'array',
            'rules' => 'array',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
